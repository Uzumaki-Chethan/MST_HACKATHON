import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { hashBytes, hashJson, inrToWei } from "@nestledger/shared";
import type { InvoiceExtraction, MilestoneReport } from "@nestledger/shared/schemas";
import { openDb, type Db } from "../db/index.js";
import { attestMilestoneClaim, attestProposalInvoice, type AttestCallFactory } from "../agent/index.js";
import type { IndexedEvent } from "../indexer/types.js";
import { runAnomalyRules, templateJustification, type AnomalyInput } from "./anomaly.js";
import type { AiDeps } from "./common.js";
import { perceptualHash } from "./integrity.js";
import { createLLM } from "./llm.js";
import { applyMilestoneRules, milestoneSupport, runMilestonePreview } from "./tasks/milestone.js";
import { runInvoicePreview } from "./tasks/invoice.js";

const chainMock = vi.hoisted(() => ({ specHash: "", caps: [] as bigint[] }));
vi.mock("./onchain.js", () => ({
  readMilestone: async () => ({ specHash: chainMock.specHash, itemCaps: chainMock.caps, round: 0 }),
  readSocietyTier1: async () => inrToWei(10_000),
}));

const DAY = 86_400;
const now = Math.floor(Date.now() / 1000);
const iso = () => new Date().toISOString();
const PLUMBER = "0x509ebe80b4e77d77f919c357ef291d6b789fd360";

const image = () => {
  const r = () => Math.floor(Math.random() * 256);
  const rects = Array.from({ length: 10 }, () => `<rect x="${r()}" y="${r() % 200}" width="${40 + (r() % 100)}" height="${30 + (r() % 80)}" fill="rgb(${r()},${r()},${r()})"/>`).join("");
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="320" height="240" fill="rgb(${r()},${r()},${r()})"/>${rects}</svg>`)).jpeg().toBuffer();
};

async function storeFile(db: Db, data: Buffer, extra: { checks?: object } = {}) {
  const hash = hashBytes(data);
  const p = path.join(db.evidenceDir, hash);
  fs.writeFileSync(p, data);
  db.run("INSERT INTO evidence (hash, mime, size, path, phash, uploader, context_type, context_id, stage, meta_json, checks_json, is_public, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    [hash, "image/jpeg", data.length, p, await perceptualHash(data), "0x1", "x", "1", "x", "{}", JSON.stringify(extra.checks ?? { fresh: true }), 0, Date.now()]);
  return hash;
}

function storeManifest(db: Db, m: { schema: string }) {
  const hash = hashJson(m);
  db.run("INSERT OR IGNORE INTO manifests (hash, schema, json, created_at) VALUES (?,?,?,?)", [hash, m.schema, JSON.stringify(m), Date.now()]);
  return hash;
}

let seq = 0;
function event(db: Db, contract: string, name: string, args: Record<string, string>, ts = now) {
  seq++;
  db.run("INSERT INTO events (contract, name, block, tx_hash, log_index, ts, args_json, k1) VALUES (?,?,?,?,?,?,?,?)",
    [contract, name, seq, `0x${seq.toString(16).padStart(64, "0")}`, 0, ts, JSON.stringify(args), args.proposalId ?? null]);
}

let db: Db;
let deps: AiDeps;
let sent: { contract: string; method: string; args: unknown[] }[];
let calls: AttestCallFactory;
beforeEach(() => {
  process.env.LLM_PROVIDER = "fixtures";
  db = openDb(":memory:");
  deps = { db, llm: createLLM(), chain: { chainId: 31337 } as AiDeps["chain"] };
  sent = [];
  calls = (contract, method, args) => ({ simulate: async () => undefined, send: async () => { sent.push({ contract, method, args }); return "0xtx"; } });
});

// ---------------------------------------------------------------- milestone

const llmOut = (over: Partial<Parameters<typeof applyMilestoneRules>[0]> = {}) => ({
  lineItems: [
    { index: 0, status: "complete" as const, supportedFraction: 0.2, evidence: "", discrepancies: [] },
    { index: 1, status: "partial" as const, supportedFraction: 0.95, evidence: "", discrepancies: [] },
    { index: 2, status: "not_done" as const, supportedFraction: 0.8, evidence: "", discrepancies: [] },
  ],
  checklist: [], matchScore: 88, summary: "", confidence: 0.85, ...over,
});

describe("milestone code rules", () => {
  it("complete → 1, partial clamped to 0.9, otherwise 0, missing items cannot_verify", () => {
    const r = applyMilestoneRules(llmOut(), 4);
    expect(r.lineItems.map((l) => l.supportedFraction)).toEqual([1, 0.9, 0, 0]);
    expect(r.lineItems[3].status).toBe("cannot_verify");
    expect(r.scoreUsed).toBe(88);
  });
  it("confidence below 0.6 zeroes every fraction and caps the score at 50", () => {
    const r = applyMilestoneRules(llmOut({ confidence: 0.5 }), 3);
    expect(r.lineItems.every((l) => l.supportedFraction === 0)).toBe(true);
    expect(r.scoreUsed).toBe(50);
  });
  it("supported = cap × fraction (floor); tainted photos → zero", () => {
    const report = { lineItems: [{ index: 0, supportedFraction: 1 }, { index: 1, supportedFraction: 0.7 }] } as MilestoneReport;
    expect(milestoneSupport(report, [BigInt(1000), BigInt(999)], false)).toEqual([BigInt(1000), BigInt(699)]);
    expect(milestoneSupport(report, [BigInt(1000), BigInt(999)], true)).toEqual([BigInt(0), BigInt(0)]);
  });
});

async function setupMilestone(tainted = false) {
  const vps = ["tiles", "counter", "sink"];
  const refs: Record<string, string> = {};
  for (const v of vps) refs[v] = await storeFile(db, await image());
  const spec = {
    schema: "nestledger.milestone-spec.v1", createdAt: iso(), title: "Civil + electrical",
    lineItems: [0, 1, 2].map((index) => ({ index, description: `item ${index}`, amountWei: inrToWei(10_000).toString(), amountINR: 10_000, acceptance: ["done"] })),
    checklist: [{ itemId: "c1", text: "matches design" }],
    vantagePoints: vps.map((id) => ({ id, description: id, referenceImageHash: refs[id] })),
    designRefs: [],
  };
  chainMock.specHash = storeManifest(db, spec);
  chainMock.caps = [inrToWei(10_000), inrToWei(10_000), inrToWei(10_000)];
  const items = [];
  for (const v of vps) {
    items.push({ hash: await storeFile(db, await image(), { checks: tainted && v === "sink" ? { reusedOf: "0xabc" } : { fresh: true } }), kind: "photo", mime: "image/jpeg", vantageId: v, captureMode: "live", capturedAt: iso() });
  }
  return storeManifest(db, { schema: "nestledger.bundle.v1", context: { type: "project", id: "7", stage: "milestone" }, createdBy: PLUMBER, createdAt: iso(), items } as never);
}

describe("runMilestonePreview (fixtures)", () => {
  it("reports per line item and previews cap × fraction", async () => {
    const bundleHash = await setupMilestone();
    const r = await runMilestonePreview({ projectId: "7", milestoneIndex: 1, bundleHash }, deps);
    expect(r.report.scoreUsed).toBe(88);
    expect(r.supportedPreview).toEqual([inrToWei(10_000), inrToWei(10_000), (inrToWei(10_000) * BigInt(7000)) / BigInt(10_000)].map(String));
    const again = await runMilestonePreview({ projectId: "7", milestoneIndex: 1, bundleHash }, deps);
    expect(again.reportHash).toBe(r.reportHash);
  });

  it("the agent reuses the preview and attests with the same support", async () => {
    const bundleHash = await setupMilestone();
    const preview = await runMilestonePreview({ projectId: "7", milestoneIndex: 1, bundleHash }, deps);
    const claim = { schema: "nestledger.claim.milestone.v1", createdAt: iso(), projectId: "7", milestoneIndex: 1, round: 0, photosBundleHash: bundleHash, previewReportHash: preview.reportHash, lineItems: [] };
    const evidenceHash = storeManifest(db, claim);
    const e: IndexedEvent = { contract: "MilestoneEscrow", name: "ClaimSubmitted", args: { id: "7", idx: "1", round: "0", items: chainMock.caps.map(String), evidenceHash, late: "false" }, blockNumber: 1, txHash: "0x1", logIndex: 0, timestamp: now };
    expect(await attestMilestoneClaim(e, deps, calls)).toBe("0xtx");
    const [id, round, , supported, score] = sent[0].args as [bigint, number, string, bigint[], number];
    expect([sent[0].contract, sent[0].method, id, round, score]).toEqual(["MilestoneEscrow", "attest", BigInt(7), 0, 88]);
    expect(supported.map(String)).toEqual(preview.supportedPreview);
  });

  it("a reused site photo zeroes the support", async () => {
    const bundleHash = await setupMilestone(true);
    const r = await runMilestonePreview({ projectId: "7", milestoneIndex: 1, bundleHash }, deps);
    expect(r.supportedPreview).toEqual(["0", "0", "0"]);
    // …and says why, so the UI never shows "Complete · AI supports ₹0" without a reason.
    expect(r.integrity.length).toBeGreaterThan(0);
    expect(r.integrity.join(" ")).toMatch(/reused/);
    const clean = await runMilestonePreview({ projectId: "7", milestoneIndex: 1, bundleHash: await setupMilestone() }, deps);
    expect(clean.integrity).toEqual([]);
  });
});

// ---------------------------------------------------------------- invoice anomaly rules

const extraction = (total: number, over: Partial<InvoiceExtraction> = {}): InvoiceExtraction => {
  const tax = Math.round(total * 0.1525);
  return {
    vendorName: "V", vendorGSTIN: "29ABCDE1234F1Z5", invoiceNumber: "N-1", invoiceDate: "2026-09-28",
    lineItems: [{ description: "work", quantity: 1, unitPriceINR: total - tax, amountINR: total - tax }],
    subtotalINR: total - tax, taxINR: tax, totalINR: total, category: "plumbing", confidence: 0.9, ...over,
  };
};
const paid = (proposalId: string, amountINR: number, over: object = {}) => ({
  proposalId, payee: PLUMBER, category: "plumbing", amountINR, invoiceNumber: `P-${proposalId}`, gstin: null, fileHashes: [], phashes: [], executedAt: now - DAY, ...over,
});
const input = (over: Partial<AnomalyInput> = {}): AnomalyInput => ({
  extraction: extraction(4800), payee: PLUMBER, category: "plumbing", proposedINR: 4800, fileHashes: [], phashes: [], tier1LimitINR: 10_000,
  paid: [paid("1", 1200), paid("2", 1500), paid("3", 1350)], pending: [], now, ...over,
});
const failed = (r: ReturnType<typeof runAnomalyRules>) => r.checks.filter((c) => !c.passed).map((c) => `${c.ruleId}:${c.severity}`);

describe("anomaly rules R1–R7", () => {
  it("demo: ₹4,800 vs a plumbing median of ₹1,350 → category and vendor spikes, risk 80, flagged", () => {
    const r = runAnomalyRules(input());
    expect(failed(r)).toEqual(["R1:high", "R2:high"]);
    expect(r).toMatchObject({ riskScore: 80, flagged: true });
    expect(templateJustification(r.checks)).toContain("3.56× the median of ₹1,350");
  });
  it("R4 ignores look-alike files from the same vendor template while the invoice number is readable", () => {
    const same = "ffffffffffffffff";
    const r = runAnomalyRules(input({ extraction: extraction(1400), proposedINR: 1400, phashes: [same], paid: [paid("1", 1200, { phashes: [same] })] }));
    expect(failed(r)).not.toContain("R4:high");
    const unreadable = runAnomalyRules(input({ extraction: extraction(1400, { invoiceNumber: "" }), proposedINR: 1400, phashes: [same], paid: [paid("1", 1200, { phashes: [same] })] }));
    expect(failed(unreadable)).toContain("R4:high");
  });
  it("normal bill passes everything", () => {
    const r = runAnomalyRules(input({ extraction: extraction(1400), proposedINR: 1400 }));
    expect(failed(r)).toEqual([]);
    expect(r).toMatchObject({ riskScore: 0, flagged: false });
  });
  it("R3 split billing: small invoices from one vendor within 30 days that add up past tier 1", () => {
    const r = runAnomalyRules(input({
      extraction: extraction(4000), proposedINR: 4000, paid: [paid("1", 4000, { executedAt: now - 3 * DAY })],
      pending: [{ proposalId: "9", amountINR: 4000, createdAt: now }],
    }));
    expect(failed(r)).toContain("R3:high");
  });
  it("R4 duplicate invoice number, R5 proposed-amount mismatch, R6 bad GSTIN, R7 new vendor large bill", () => {
    expect(failed(runAnomalyRules(input({ extraction: extraction(1400, { invoiceNumber: "P-2" }), proposedINR: 1400 })))).toContain("R4:high");
    expect(failed(runAnomalyRules(input({ extraction: extraction(1400), proposedINR: 1400, fileHashes: ["0xf1"], paid: [paid("1", 1200, { fileHashes: ["0xf1"] })] })))).toContain("R4:high");
    expect(failed(runAnomalyRules(input({ extraction: extraction(1400), proposedINR: 1500 })))).toContain("R5:high");
    const gst = runAnomalyRules(input({ extraction: extraction(1400, { vendorGSTIN: null }), proposedINR: 1400 }));
    expect(failed(gst)).toEqual(["R6:low"]);
    expect(gst).toMatchObject({ riskScore: 10, flagged: false });
    expect(failed(runAnomalyRules(input({ paid: [], extraction: extraction(12_000), proposedINR: 12_000 })))).toContain("R7:medium");
  });
});

// ---------------------------------------------------------------- invoice task + agent

async function invoiceDoc(amountINR: number) {
  const file = await storeFile(db, await image());
  return storeManifest(db, {
    schema: "nestledger.invoice.v1", createdAt: iso(), societyId: "1", payee: PLUMBER,
    declaredAmountWei: inrToWei(amountINR).toString(), declaredAmountINR: amountINR, category: "plumbing", files: [file],
  } as never);
}

async function seedHistory() {
  for (const [id, amt] of [["1", 1200], ["2", 1500], ["3", 1350]] as const) {
    const docHash = await invoiceDoc(amt);
    event(db, "SocietyLedger", "ProposalCreated", { proposalId: id, societyId: "1", kind: "0", payee: PLUMBER, amount: inrToWei(amt).toString(), docHash, category: "plumbing", tier: "0" }, now - 2 * DAY);
    event(db, "SocietyLedger", "ProposalExecuted", { proposalId: id, kind: "0", payee: PLUMBER, amount: inrToWei(amt).toString(), resultRef: "0" }, now - DAY);
  }
}

describe("runInvoicePreview + attestInvoice (fixtures)", () => {
  it("flags the demo bill from real history and posts attestInvoice(id, hash, 80, true)", async () => {
    await seedHistory();
    const docHash = await invoiceDoc(4800);
    event(db, "SocietyLedger", "ProposalCreated", { proposalId: "4", societyId: "1", kind: "0", payee: PLUMBER, amount: inrToWei(4800).toString(), docHash, category: "plumbing", tier: "0" });
    const e: IndexedEvent = { contract: "SocietyLedger", name: "ProposalCreated", args: { proposalId: "4", societyId: "1", kind: "0", payee: PLUMBER, amount: inrToWei(4800).toString(), docHash, category: "plumbing", tier: "0" }, blockNumber: 99, txHash: "0x2", logIndex: 0, timestamp: now };
    expect(await attestProposalInvoice(e, deps, calls)).toBe("0xtx");
    const [id, reportHash, risk, flagged] = sent[0].args as [bigint, string, number, boolean];
    expect([sent[0].method, id, risk, flagged]).toEqual(["attestInvoice", BigInt(4), 80, true]);
    const stored = db.get<{ json: string; is_public: number }>("SELECT json, is_public FROM reports WHERE hash = ?", [reportHash]);
    expect(stored?.is_public).toBe(1);
    expect(JSON.parse(stored!.json)).toMatchObject({ proposalId: "4", flagged: true, extraction: { invoiceNumber: "SPW-0455", totalINR: 4800 } });
  });

  it("the history bills themselves are clean (tier 0 stays tier 0 during seeding)", async () => {
    await seedHistory();
    const r = await runInvoicePreview({ societyId: "1", bundleHash: await invoiceDoc(1350), payee: PLUMBER, amountWei: inrToWei(1350).toString() }, deps);
    expect(r.report.checks.filter((c) => !c.passed)).toEqual([]);
    expect(r.report).toMatchObject({ flagged: false, riskScore: 0 });
    expect(r.report.justification).toMatch(/No anomalies/);
  });
});
