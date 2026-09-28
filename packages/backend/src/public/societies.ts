// SPEC §7.3 / §8.5 public transparency API (no login). Response shapes are documented in CLAUDE1.md.
//   GET /public/societies/:id          dashboard aggregate (cached 5 s)
//   GET /public/societies/:id/ledger   paginated inflows and outflows with invoices, AI flags and approvers
import type { FastifyInstance } from "fastify";
import { Contract } from "ethers";
import { explorerAddress, ProposalKind, ProposalStatus, societyLedgerAbi } from "@nestledger/shared";
import type { ChainClients } from "../chain/index.js";
import { addressOf } from "../chain/index.js";
import type { Db } from "../db/index.js";
import { badRequest, HttpError, notFound } from "../errors.js";

const CACHE_MS = 5_000;
const PAGE = 25;
const ZERO = "0x" + "0".repeat(64);

type EventRow = { id: number; name: string; block: number; tx_hash: string; ts: number; args_json: string };
type Args = Record<string, string>;

const monthKey = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 7); // "2026-09"
const lc = (a: string) => a.toLowerCase();

function jsonOf(db: Db, table: "manifests" | "reports", hash: string | undefined): any | null {
  if (!hash || hash === ZERO) return null;
  const row = db.get<{ json: string }>(`SELECT json FROM ${table} WHERE hash = ?`, [hash.toLowerCase()]);
  return row ? JSON.parse(row.json) : null;
}

/** Society money movements from the indexer: maintenance + deposits in, executed proposals out. */
function flowEvents(db: Db, societyId: string, proposalIds: string[], beforeId?: number, limit = 10_000): EventRow[] {
  const ids = proposalIds.length ? proposalIds : ["-1"];
  return db.query<EventRow>(
    `SELECT id, name, block, tx_hash, ts, args_json FROM events
     WHERE contract = 'SocietyLedger' AND id < ? AND (
       (name = 'MaintenancePaid' AND json_extract(args_json, '$.societyId') = ?) OR
       (name = 'Deposited' AND json_extract(args_json, '$.societyId') = ?) OR
       (name = 'ProposalExecuted' AND json_extract(args_json, '$.proposalId') IN (${ids.map(() => "?").join(",")})))
     ORDER BY id DESC LIMIT ?`,
    [beforeId ?? Number.MAX_SAFE_INTEGER, societyId, societyId, ...ids, limit]);
}

export function registerPublicSocieties(app: FastifyInstance, db: Db, chain: ChainClients) {
  const cache = new Map<string, { at: number; body: unknown }>();

  function ledgerContract() {
    const address = addressOf(chain.chainId, "SocietyLedger");
    if (!address) throw new HttpError(503, "NOT_DEPLOYED", "SocietyLedger is not deployed on this chain");
    return { address, ledger: new Contract(address, societyLedgerAbi, chain.provider) };
  }

  async function loadSociety(id: string) {
    if (!/^\d+$/.test(id)) throw badRequest("id must be a number");
    const { address, ledger } = ledgerContract();
    const s = await ledger.getSociety(id);
    if (s.admin === "0x0000000000000000000000000000000000000000") throw notFound("No such society");
    const [flatIds, proposalIds] = await Promise.all([ledger.flatsOf(id), ledger.proposalsOf(id)]);
    const flats = await Promise.all(flatIds.map(async (fid: bigint) => [fid, await ledger.getFlat(fid)] as const));
    const proposals = await Promise.all(proposalIds.map(async (pid: bigint) => [pid, await ledger.getProposal(pid)] as const));
    return { address, ledger, s, flats, proposals };
  }

  app.get<{ Params: { id: string } }>("/public/societies/:id", async (req) => {
    const hit = cache.get(req.params.id);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.body;

    const { address, ledger, s, flats, proposals } = await loadSociety(req.params.id);
    const nowMonth = monthKey(Math.floor(Date.now() / 1000));
    const pidStrings = proposals.map(([pid]) => pid.toString());
    const events = flowEvents(db, req.params.id, pidStrings);

    // Monthly series (last 6 calendar months) and spend by category, from indexed history.
    const months: string[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setUTCDate(1);
      d.setUTCMonth(d.getUTCMonth() - i);
      months.push(d.toISOString().slice(0, 7));
    }
    const collected = new Map<string, bigint>(), spent = new Map<string, bigint>(), byCategory = new Map<string, bigint>();
    const categoryOf = new Map(proposals.map(([pid, p]) => [pid.toString(), p.category as string]));
    const paidFlatsThisMonth = new Set<string>();
    for (const e of events) {
      const a = JSON.parse(e.args_json) as Args;
      const m = monthKey(e.ts);
      if (e.name === "MaintenancePaid") {
        collected.set(m, (collected.get(m) ?? 0n) + BigInt(a.amount));
        if (m === nowMonth) paidFlatsThisMonth.add(a.flatId);
      } else if (e.name === "ProposalExecuted") {
        spent.set(m, (spent.get(m) ?? 0n) + BigInt(a.amount));
        const cat = categoryOf.get(a.proposalId) || "other";
        byCategory.set(cat, (byCategory.get(cat) ?? 0n) + BigInt(a.amount));
      }
    }

    const open = [];
    for (const [pid, p] of proposals) {
      const status = ProposalStatus[Number(p.status)];
      if (status !== "Pending" && status !== "CommitteeApproved") continue;
      const [[ok, reason], effTier, required] = await Promise.all([
        ledger.canExecute(pid), ledger.effectiveTier(pid), ledger.requiredApprovals(pid),
      ]);
      const report = jsonOf(db, "reports", p.reportHash);
      open.push({
        proposalId: pid.toString(), kind: ProposalKind[Number(p.kind)], status, payee: lc(p.payee),
        amountWei: p.amount.toString(), category: p.category, docHash: p.docHash,
        tier: Number(p.tier), effectiveTier: Number(effTier), approvals: Number(p.approvals), requiredApprovals: Number(required),
        attested: p.attested, flagged: p.flagged, riskScore: Number(p.riskScore), reportHash: p.reportHash,
        justification: report?.justification ?? null,
        createdAt: Number(p.createdAt), voteEnds: Number(p.voteEnds),
        votesFor: p.votesFor.toString(), votesAgainst: p.votesAgainst.toString(),
        totalWeight: Number(s.totalWeight), quorumBps: Number(s.config.quorumBps),
        canExecute: ok, reason,
      });
    }

    const body = {
      societyId: req.params.id, name: s.name, admin: lc(s.admin), metaHash: s.metaHash,
      meta: jsonOf(db, "manifests", s.metaHash),
      contract: lc(address), explorerUrl: explorerAddress(address),
      committee: s.committee.map(lc),
      config: {
        threshold: Number(s.config.threshold), tier1LimitWei: s.config.tier1Limit.toString(), tier2LimitWei: s.config.tier2Limit.toString(),
        quorumBps: Number(s.config.quorumBps), votingPeriod: Number(s.config.votingPeriod), attestTimeout: Number(s.config.attestTimeout),
      },
      totals: {
        balanceWei: s.balance.toString(), committedWei: s.committed.toString(), availableWei: (s.balance - s.committed).toString(),
        totalCollectedWei: s.totalCollected.toString(), totalSpentWei: s.totalSpent.toString(),
        collectedThisMonthWei: (collected.get(nowMonth) ?? 0n).toString(), spentThisMonthWei: (spent.get(nowMonth) ?? 0n).toString(),
      },
      monthly: months.map((m) => ({ month: m, collectedWei: (collected.get(m) ?? 0n).toString(), spentWei: (spent.get(m) ?? 0n).toString() })),
      spendByCategory: [...byCategory].map(([category, v]) => ({ category, spentWei: v.toString() })),
      flats: flats.map(([fid, f]) => ({
        flatId: fid.toString(), label: f.label, weight: Number(f.weight), maintenanceWei: f.maintenance.toString(),
        totalPaidWei: f.totalPaid.toString(), lastPaidAt: Number(f.lastPaidAt), paidThisMonth: paidFlatsThisMonth.has(fid.toString()),
      })),
      openProposals: open,
      updatedAt: new Date().toISOString(),
    };
    cache.set(req.params.id, { at: Date.now(), body });
    return body;
  });

  app.get<{ Params: { id: string }; Querystring: { cursor?: string } }>("/public/societies/:id/ledger", async (req) => {
    const { proposals, flats } = await loadSociety(req.params.id);
    const cursor = req.query.cursor ? Number(req.query.cursor) : undefined;
    if (cursor !== undefined && !Number.isInteger(cursor)) throw badRequest("cursor must be a number");
    const byId = new Map(proposals.map(([pid, p]) => [pid.toString(), p]));
    const labels = new Map(flats.map(([fid, f]) => [fid.toString(), f.label as string]));
    const rows = flowEvents(db, req.params.id, [...byId.keys()], cursor, PAGE + 1);

    const items = rows.slice(0, PAGE).map((e) => {
      const a = JSON.parse(e.args_json) as Args;
      const base = { id: e.id, txHash: e.tx_hash, blockNumber: e.block, timestamp: e.ts };
      if (e.name === "MaintenancePaid") {
        return { ...base, direction: "in", type: "maintenance", amountWei: a.amount, from: a.payer, flatId: a.flatId, flatLabel: labels.get(a.flatId) ?? null };
      }
      if (e.name === "Deposited") return { ...base, direction: "in", type: "deposit", amountWei: a.amount, from: a.from };

      const p = byId.get(a.proposalId);
      const invoice = jsonOf(db, "manifests", p?.docHash);
      const report = jsonOf(db, "reports", p?.reportHash);
      const approvers = db.query<{ args_json: string }>(
        "SELECT args_json FROM events WHERE contract = 'SocietyLedger' AND name = 'Approved' AND k1 = ? ORDER BY id", [a.proposalId],
      ).map((r) => {
        const x = JSON.parse(r.args_json) as Args;
        const note = jsonOf(db, "manifests", x.overrideReasonHash);
        return { member: x.member, overrideReasonHash: x.overrideReasonHash === ZERO ? null : x.overrideReasonHash, overrideText: note?.text ?? null };
      });
      return {
        ...base, direction: "out", type: ProposalKind[Number(a.kind)], amountWei: a.amount, payee: a.payee,
        proposalId: a.proposalId, category: p?.category ?? null, docHash: p?.docHash ?? null,
        invoiceFiles: (invoice?.files as string[] | undefined) ?? [],
        reportHash: p && p.reportHash !== ZERO ? p.reportHash : null, riskScore: p ? Number(p.riskScore) : null,
        flagged: p?.flagged ?? false, justification: report?.justification ?? null, approvers, resultRef: a.resultRef,
      };
    });
    return { items, nextCursor: rows.length > PAGE ? String(items[items.length - 1].id) : null };
  });
}
