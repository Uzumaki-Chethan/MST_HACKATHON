// SPEC §6.6, §6.8 — the AI attestor agent. Watches indexed events and posts attestations
// from its own wallet (ATTESTOR_ROLE). It only ever calls attest(); it cannot move funds.
import { Contract, type ContractRunner } from "ethers";
import { addresses, milestoneEscrowAbi, rentalEscrowAbi, societyLedgerAbi, type ContractName } from "@nestledger/shared";
import {
  AttestationReportSchema,
  BundleSchema,
  MilestoneClaimSchema,
  MoveOutReportSchema,
  RentalClaimSchema,
  type AttestationReport,
} from "@nestledger/shared/schemas";
import type { ChainClients } from "../chain/index.js";
import type { Db } from "../db/index.js";
import type { IndexedEvent, IndexerEvents } from "../indexer/types.js";
import { storeReport } from "../ai/common.js";
import { isTainted } from "../ai/integrity.js";
import { PROMPT_VERSION, type VisionLLM } from "../ai/llm.js";
import { runMilestonePreview } from "../ai/tasks/milestone.js";
import { runInvoicePreview } from "../ai/tasks/invoice.js";
import { buildRentalAttestation } from "./rental.js";
import { jobStatus, runJob, type AttestCall } from "./tx.js";

export type AgentDeps = { indexer: IndexerEvents; db: Db; chain: ChainClients; llm: VisionLLM };

/** Seam for tests: how an attest(...) call on a contract is simulated and sent. */
export type AttestCallFactory = (contract: ContractName, method: string, args: unknown[]) => AttestCall | null;

const ABIS: Partial<Record<ContractName, readonly unknown[]>> = {
  RentalEscrow: rentalEscrowAbi,
  MilestoneEscrow: milestoneEscrowAbi,
  SocietyLedger: societyLedgerAbi,
};

export function ethersCalls(chain: ChainClients): AttestCallFactory {
  return (name, method, args) => {
    const address = addresses[chain.chainId]?.[name];
    const abi = ABIS[name];
    if (!address || !abi) return null;
    const c = new Contract(address, abi as never, chain.attestor as ContractRunner);
    return {
      simulate: () => c[method].staticCall(...args),
      send: async () => {
        const tx = await c[method](...args);
        await tx.wait(1);
        return tx.hash as string;
      },
    };
  };
}

function log(msg: string) {
  console.log(`[agent] ${msg}`);
}

function readManifest(db: Db, hash: string): unknown | null {
  const row = db.get<{ json: string }>("SELECT json FROM manifests WHERE hash = ?", [hash.toLowerCase()]);
  return row ? JSON.parse(row.json) : null;
}

function readReport(db: Db, hash: string): unknown | null {
  const row = db.get<{ json: string }>("SELECT json FROM reports WHERE hash = ?", [hash.toLowerCase()]);
  return row ? JSON.parse(row.json) : null;
}

/** Vantages whose move-out photo is reused or not fresh: their items get 0 support (SPEC §6.5). */
function taintedVantages(db: Db, bundleHash: string): Set<string> {
  const bundle = BundleSchema.safeParse(readManifest(db, bundleHash));
  const out = new Set<string>();
  if (!bundle.success) return out;
  for (const it of bundle.data.items) {
    const row = db.get<{ checks_json: string | null }>("SELECT checks_json FROM evidence WHERE hash = ?", [it.hash]);
    const checks = row?.checks_json ? JSON.parse(row.checks_json) : it.checks;
    if (it.vantageId && isTainted(checks)) out.add(it.vantageId);
  }
  return out;
}

export async function attestRentalClaim(e: IndexedEvent, deps: Omit<AgentDeps, "indexer">, calls: AttestCallFactory): Promise<string | null> {
  const { db } = deps;
  const id = String(e.args.id), idx = Number(e.args.idx), round = Number(e.args.round);
  const key = `attest:RentalEscrow:${id}:${idx}:${round}`;
  const evidenceHash = String(e.args.evidenceHash).toLowerCase();
  const onchainItems = (e.args.items as string[]).map((x) => BigInt(x));
  const done = jobStatus(db, key);
  if (done === "done" || done === "skipped") return null;

  const claim = RentalClaimSchema.safeParse(readManifest(db, evidenceHash));
  if (!claim.success) {
    log(`${key}: claim manifest ${evidenceHash} missing or invalid; not attesting (items stay unbacked)`);
    return null;
  }
  const report = MoveOutReportSchema.safeParse(readReport(db, claim.data.moveOutReportHash));
  if (!report.success) {
    log(`${key}: move-out report ${claim.data.moveOutReportHash} missing; not attesting`);
    return null;
  }

  const att = buildRentalAttestation({
    onchainItems,
    claim: claim.data,
    report: report.data,
    taintedVantages: taintedVantages(db, report.data.moveOutBundleHash),
  });
  const wrapper: AttestationReport = AttestationReportSchema.parse({
    schema: "nestledger.report.attestation.v1",
    createdAt: new Date().toISOString(),
    contract: "RentalEscrow",
    agreementId: id,
    trancheIdx: idx,
    round,
    sourceReportHash: claim.data.moveOutReportHash,
    claimManifestHash: evidenceHash,
    mapping: att.mapping,
    score: att.score,
    model: report.data.model,
    promptVersion: PROMPT_VERSION,
  });
  const reportHash = storeReport(db, { task: "attestation", report: wrapper, contextType: "lease", contextId: id });

  const call = calls("RentalEscrow", "attest", [BigInt(id), round, reportHash, att.supported, att.score]);
  if (!call) {
    log(`${key}: RentalEscrow not deployed on chain ${deps.chain.chainId}`);
    return null;
  }
  const txHash = await runJob(db, key, "attest", call);
  if (txHash) log(`${key}: attested, supported=[${att.supported.join(",")}] score=${att.score} tx=${txHash}`);
  return txHash;
}

/** SPEC §6.6: reuse the contractor's preview when it covers the same photos, otherwise run Task 3. */
export async function attestMilestoneClaim(e: IndexedEvent, deps: Omit<AgentDeps, "indexer">, calls: AttestCallFactory): Promise<string | null> {
  const { db } = deps;
  const id = String(e.args.id), idx = Number(e.args.idx), round = Number(e.args.round);
  const key = `attest:MilestoneEscrow:${id}:${idx}:${round}`;
  const done = jobStatus(db, key);
  if (done === "done" || done === "skipped") return null;
  const evidenceHash = String(e.args.evidenceHash).toLowerCase();
  const onchainItems = (e.args.items as string[]).length;

  const claim = MilestoneClaimSchema.safeParse(readManifest(db, evidenceHash));
  if (!claim.success) {
    log(`${key}: milestone claim manifest ${evidenceHash} missing or invalid; not attesting`);
    return null;
  }
  // runMilestonePreview returns the stored report (the contractor's preview) when bundle and spec match.
  const { report, reportHash, supportedPreview } = await runMilestonePreview(
    { projectId: id, milestoneIndex: idx, bundleHash: claim.data.photosBundleHash },
    deps,
  );
  const supported = supportedPreview.slice(0, onchainItems).map((x) => BigInt(x));
  while (supported.length < onchainItems) supported.push(BigInt(0));

  const wrapper = AttestationReportSchema.parse({
    schema: "nestledger.report.attestation.v1",
    createdAt: new Date().toISOString(),
    contract: "MilestoneEscrow",
    agreementId: id,
    trancheIdx: idx,
    round,
    sourceReportHash: reportHash,
    claimManifestHash: evidenceHash,
    mapping: supported.map((s, i) => {
      const line = report.lineItems.find((l) => l.index === i);
      return {
        item: i, ref: `line-${i}`, supportedWei: s.toString(),
        reason: line ? `${line.status.replace("_", " ")}: ${line.evidence}` : "Not assessed.",
      };
    }),
    score: report.scoreUsed,
    model: report.model,
    promptVersion: PROMPT_VERSION,
  });
  const attHash = storeReport(db, { task: "attestation", report: wrapper, contextType: "project", contextId: id });

  const call = calls("MilestoneEscrow", "attest", [BigInt(id), round, attHash, supported, report.scoreUsed]);
  if (!call) {
    log(`${key}: MilestoneEscrow not deployed on chain ${deps.chain.chainId}`);
    return null;
  }
  const txHash = await runJob(db, key, "attest", call);
  if (txHash) log(`${key}: attested, supported=[${supported.join(",")}] score=${report.scoreUsed} tx=${txHash}`);
  return txHash;
}

/** SPEC §6.6: Tasks 4 + 5 on a PayVendor proposal's invoice, then attestInvoice. A flag never blocks; it escalates. */
export async function attestProposalInvoice(e: IndexedEvent, deps: Omit<AgentDeps, "indexer">, calls: AttestCallFactory): Promise<string | null> {
  const { db } = deps;
  const proposalId = String(e.args.proposalId);
  const key = `attestInvoice:SocietyLedger:${proposalId}`;
  const done = jobStatus(db, key);
  if (done === "done" || done === "skipped") return null;

  const { report, reportHash } = await runInvoicePreview(
    {
      societyId: String(e.args.societyId),
      bundleHash: String(e.args.docHash),
      payee: String(e.args.payee),
      amountWei: String(e.args.amount),
      proposalId,
    },
    deps,
  );
  const call = calls("SocietyLedger", "attestInvoice", [BigInt(proposalId), reportHash, report.riskScore, report.flagged]);
  if (!call) {
    log(`${key}: SocietyLedger not deployed on chain ${deps.chain.chainId}`);
    return null;
  }
  const txHash = await runJob(db, key, "attestInvoice", call);
  if (txHash) log(`${key}: risk ${report.riskScore}, flagged=${report.flagged}, tx=${txHash}`);
  return txHash;
}

export async function handleEvent(e: IndexedEvent, deps: Omit<AgentDeps, "indexer">, calls: AttestCallFactory): Promise<void> {
  try {
    if (e.contract === "RentalEscrow" && e.name === "ClaimSubmitted") await attestRentalClaim(e, deps, calls);
    if (e.contract === "MilestoneEscrow" && e.name === "ClaimSubmitted") await attestMilestoneClaim(e, deps, calls);
    if (e.contract === "SocietyLedger" && e.name === "ProposalCreated" && e.args.kind === "0") await attestProposalInvoice(e, deps, calls);
  } catch (err) {
    // Failures post nothing: items stay unbacked / the proposal waits for attestTimeout, and humans decide (SPEC N5).
    log(`${e.contract}.${e.name} ${e.txHash}: ${(err as Error).message}`);
  }
}

/** Re-processes indexed claims whose attestation job never finished (e.g. the backend restarted). */
export async function backfill(deps: Omit<AgentDeps, "indexer">, calls: AttestCallFactory): Promise<void> {
  const rows = deps.db.query<{ contract: string; name: string; block: number; tx_hash: string; log_index: number; ts: number; args_json: string }>(
    `SELECT contract, name, block, tx_hash, log_index, ts, args_json FROM events
     WHERE (contract IN ('RentalEscrow', 'MilestoneEscrow') AND name = 'ClaimSubmitted')
        OR (contract = 'SocietyLedger' AND name = 'ProposalCreated')
     ORDER BY block, log_index`,
  );
  for (const r of rows) {
    await handleEvent(
      { contract: r.contract, name: r.name, args: JSON.parse(r.args_json), blockNumber: r.block, txHash: r.tx_hash, logIndex: r.log_index, timestamp: r.ts },
      deps,
      calls,
    );
  }
}

export function startAgent(deps: AgentDeps): void {
  const calls = ethersCalls(deps.chain);
  deps.indexer.on("event", (e: IndexedEvent) => void handleEvent(e, deps, calls));
  void backfill(deps, calls);
  log(`started; attestor ${deps.chain.attestor.address}, model ${deps.llm.id}`);
}
