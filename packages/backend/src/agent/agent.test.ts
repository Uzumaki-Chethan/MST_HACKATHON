import { beforeEach, describe, expect, it } from "vitest";
import { hashJson, inrToWei } from "@nestledger/shared";
import type { MoveOutReport, RentalClaim } from "@nestledger/shared/schemas";
import { openDb, type Db } from "../db/index.js";
import { createLLM } from "../ai/llm.js";
import type { IndexedEvent } from "../indexer/types.js";
import { attestRentalClaim, type AttestCallFactory } from "./index.js";
import { buildRentalAttestation } from "./rental.js";
import { jobStatus, runJob } from "./tx.js";

const H = (n: number) => ("0x" + n.toString(16).padStart(64, "0")) as `0x${string}`;
const now = () => new Date().toISOString();

const finding = (id: string, over: Partial<MoveOutReport["findings"][number]>): MoveOutReport["findings"][number] => ({
  findingId: id, room: "kitchen", elementId: "kitchen.tiles", vantageId: "kitchen-counter", change: "new_damage", severity: 2,
  description: "Cracked tile.", beforePhotoRef: "a", afterPhotoRef: "b", rateItemId: "tile_replace", quantity: 1,
  estimatedCostINR: 450, deductible: true, confidence: 0.84, ...over,
});

const report: MoveOutReport = {
  schema: "nestledger.report.move-out.v1", createdAt: now(), model: "fixtures", promptVersion: "x", leaseId: "1",
  baselineReportHash: H(1), baselineStatus: "Agreed", moveOutBundleHash: H(2),
  findings: [
    finding("f1", {}),
    finding("f2", { change: "normal_wear", deductible: false, estimatedCostINR: 0, vantageId: "living-wide", confidence: 0.78 }),
    finding("f3", { confidence: 0.4, vantageId: "bed1-wall" }),
    finding("f4", { vantageId: "bath1-fittings", estimatedCostINR: 700 }),
  ],
  unpairedVantages: [], summary: "", totals: { deductibleINR: 1600, findings: 4 },
};

const claimItem = (index: number, type: RentalClaim["items"][number]["type"], findingId?: string, inr = 0) => ({
  index, type, description: "x", amountWei: inrToWei(inr).toString(), amountINR: inr, ...(findingId ? { findingId } : {}),
});

const claim: RentalClaim = {
  schema: "nestledger.claim.rental.v1", createdAt: now(), leaseId: "1", moveOutReportHash: hashJson(report),
  items: [
    claimItem(0, "unpaid_dues"),
    claimItem(1, "damage", "f1", 450),
    claimItem(2, "other", "f2", 6000),
    claimItem(3, "damage", "f3", 450),
    claimItem(4, "damage", "f4", 700),
    claimItem(5, "other", undefined, 2000),
  ],
};
const onchain = claim.items.map((i) => BigInt(i.amountWei));

describe("buildRentalAttestation", () => {
  it("backs only deductible, confident, clean findings; item 0 and landlord-added items get 0", () => {
    const att = buildRentalAttestation({ onchainItems: onchain, claim, report, taintedVantages: new Set(["bath1-fittings"]) });
    expect(att.supported).toEqual([BigInt(0), inrToWei(450), BigInt(0), BigInt(0), BigInt(0), BigInt(0)]);
    expect(att.mapping.map((m) => m.ref)).toEqual(["unpaid_dues", "f1", "f2", "f3", "f4", "landlord-added"]);
    expect(att.mapping[4].reason).toMatch(/integrity/);
    expect(att.score).toBe(Math.round(((0.84 + 0.78 + 0.4 + 0.84) / 4) * 100));
  });
});

describe("attestRentalClaim", () => {
  let db: Db;
  let sent: unknown[][];
  let calls: AttestCallFactory;
  const deps = () => ({ db, chain: { chainId: 31337 } as never, llm: createLLM() });
  const event = (round = 0): IndexedEvent => ({
    contract: "RentalEscrow", name: "ClaimSubmitted",
    args: { id: "1", idx: "0", round: String(round), items: onchain.map(String), evidenceHash: hashJson(claim), late: "false" },
    blockNumber: 1, txHash: H(9), logIndex: 0, timestamp: 0,
  });

  beforeEach(() => {
    process.env.LLM_PROVIDER = "fixtures";
    db = openDb(":memory:");
    db.run("INSERT INTO manifests (hash, schema, json, created_at) VALUES (?,?,?,?)", [hashJson(claim), claim.schema, JSON.stringify(claim), 0]);
    db.run("INSERT INTO reports (hash, task, json, created_at) VALUES (?,?,?,?)", [hashJson(report), "moveOut", JSON.stringify(report), 0]);
    sent = [];
    calls = (_c, _m, args) => ({ simulate: async () => undefined, send: async () => { sent.push(args); return H(77); } });
  });

  it("posts attest(id, round, reportHash, supported, score) once and stores the wrapper report", async () => {
    expect(await attestRentalClaim(event(), deps(), calls)).toBe(H(77));
    const [id, round, reportHash, supported] = sent[0] as [bigint, number, string, bigint[]];
    expect(id).toBe(BigInt(1));
    expect(round).toBe(0);
    expect(supported[1]).toBe(inrToWei(450));
    const stored = db.get<{ task: string; json: string }>("SELECT task, json FROM reports WHERE hash = ?", [reportHash]);
    expect(stored?.task).toBe("attestation");
    expect(JSON.parse(stored!.json).claimManifestHash).toBe(hashJson(claim));
    expect(await attestRentalClaim(event(), deps(), calls)).toBeNull();
    expect(sent).toHaveLength(1);
  });

  it("skips when staticCall reverts (already attested or stale round)", async () => {
    calls = () => ({ simulate: async () => { throw new Error("BadStatus()"); }, send: async () => H(1) });
    expect(await attestRentalClaim(event(1), deps(), calls)).toBeNull();
    expect(jobStatus(db, "attest:RentalEscrow:1:0:1")).toBe("skipped");
  });

  it("does not attest without the claim manifest (items stay unbacked, humans decide)", async () => {
    db.run("DELETE FROM manifests");
    expect(await attestRentalClaim(event(), deps(), calls)).toBeNull();
    expect(sent).toHaveLength(0);
  });
});

describe("runJob", () => {
  it("retries a failing send and records the tx hash", async () => {
    const db = openDb(":memory:");
    let n = 0;
    const tx = await runJob(db, "k", "attest", {
      simulate: async () => undefined,
      send: async () => { if (++n < 3) throw new Error("nonce too low"); return "0xabc"; },
    }, { backoffMs: 1 });
    expect(tx).toBe("0xabc");
    expect(db.get<{ status: string; attempts: number }>("SELECT status, attempts FROM jobs WHERE key = 'k'")).toMatchObject({ status: "done", attempts: 3 });
  });
});
