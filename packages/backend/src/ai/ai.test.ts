import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { hashBytes, hashJson } from "@nestledger/shared";
import { openDb, type Db } from "../db/index.js";
import { checkEvidence, perceptualHash } from "./integrity.js";
import { createLLM } from "./llm.js";
import { runMoveIn } from "./tasks/moveIn.js";
import { runMoveOut } from "./tasks/moveOut.js";
import type { AiDeps } from "./common.js";

const baselineMock = vi.hoisted(() => ({ value: { status: "Agreed", baselineReportHash: "", counterEvidence: null as string | null } }));
vi.mock("./lease.js", () => ({ readLeaseBaseline: async () => baselineMock.value }));

// Random coloured rectangles: distinct structure per call, so perceptual hashes differ between photos.
const noisyJpeg = () => {
  const r = () => Math.floor(Math.random() * 256);
  const rects = Array.from({ length: 12 }, () =>
    `<rect x="${r()}" y="${r() % 200}" width="${40 + (r() % 120)}" height="${30 + (r() % 90)}" fill="rgb(${r()},${r()},${r()})"/>`).join("");
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="320" height="240" fill="rgb(${r()},${r()},${r()})"/>${rects}</svg>`))
    .jpeg()
    .toBuffer();
};

const now = () => new Date().toISOString();
const VANTAGES = [
  ["living", "living-wide"],
  ["kitchen", "kitchen-counter"],
  ["bedroom1", "bed1-wall"],
  ["bathroom1", "bath1-fittings"],
] as const;

async function storePhoto(db: Db, data: Buffer, room: string, vantageId: string) {
  const hash = hashBytes(data);
  const p = path.join(db.evidenceDir, hash);
  fs.writeFileSync(p, data);
  db.run(
    "INSERT INTO evidence (hash, mime, size, path, phash, uploader, context_type, context_id, stage, meta_json, checks_json, is_public, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    [hash, "image/jpeg", data.length, p, await perceptualHash(data), "0x1", "lease", "1", "move-in", "{}", JSON.stringify({ fresh: true }), 0, Date.now()],
  );
  return { hash, kind: "photo" as const, mime: "image/jpeg", room, vantageId, captureMode: "live" as const, capturedAt: now() };
}

async function storeBundle(db: Db, stage: "move-in" | "move-out") {
  const items = [];
  for (const [room, v] of VANTAGES) items.push(await storePhoto(db, await noisyJpeg(), room, v));
  const bundle = {
    schema: "nestledger.bundle.v1", context: { type: "lease", id: "1", stage },
    createdBy: "0x" + "11".repeat(20), createdAt: now(), items,
  };
  const hash = hashJson(bundle);
  db.run("INSERT INTO manifests (hash, schema, json, uploader, context_type, context_id, is_public, created_at) VALUES (?,?,?,?,?,?,?,?)",
    [hash, bundle.schema, JSON.stringify(bundle), "0x1", "lease", "1", 0, Date.now()]);
  return hash;
}

let db: Db;
let deps: AiDeps;
beforeEach(() => {
  process.env.LLM_PROVIDER = "fixtures";
  db = openDb(":memory:");
  deps = { db, llm: createLLM(), chain: {} as AiDeps["chain"] };
});

describe("checkEvidence", () => {
  it("flags a re-encoded copy of a stored photo as reused", async () => {
    const original = await noisyJpeg();
    await storePhoto(db, original, "living", "living-wide");
    const copy = await sharp(original).resize(300).jpeg({ quality: 60 }).toBuffer();
    const r = await checkEvidence(copy, { context: { type: "lease", id: "1", stage: "move-out" }, kind: "photo", captureMode: "live", capturedAt: now() },
      { db, receivedAt: Date.now(), location: null });
    expect(r.reusedOf).toBe(hashBytes(original));
    expect(r.fresh).toBe(true);
  });

  it("does not flag a different photo as reused (colour input gives a full-width hash)", async () => {
    const scene = (svg: string) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300">${svg}</svg>`)).jpeg().toBuffer();
    const a = await scene(`<rect width="400" height="300" fill="#c8b89a"/><rect x="0" y="0" width="200" height="300" fill="#3a5f8a"/>`);
    const b = await scene(`<rect width="400" height="300" fill="#c8b89a"/><rect x="0" y="150" width="400" height="150" fill="#8a3a3a"/><circle cx="300" cy="80" r="50" fill="#222"/>`);
    const [ha, hb] = [await perceptualHash(a), await perceptualHash(b)];
    expect(ha).toMatch(/^[0-9a-f]{16}$/);
    expect(ha!.slice(4)).not.toBe("000000000000");
    await storePhoto(db, a, "living", "living-wide");
    const r = await checkEvidence(b, { context: { type: "lease", id: "1", stage: "move-out" }, kind: "photo", captureMode: "live", capturedAt: now() },
      { db, receivedAt: Date.now(), location: null });
    expect(hb).not.toBe(ha);
    expect(r.reusedOf).toBeUndefined();
    expect(r.nearDuplicateOf).toBeUndefined();
  });

  it("marks old live captures not fresh, applies the geofence, and tolerates non-images", async () => {
    const meta = {
      context: { type: "lease", id: "1", stage: "move-in" }, kind: "photo", captureMode: "live" as const,
      capturedAt: new Date(Date.now() - 10 * 60_000).toISOString(), geo: { lat: 12.9416, lng: 77.5661, acc: 10 },
    };
    const r = await checkEvidence(await noisyJpeg(), meta, { db, receivedAt: Date.now(), location: { lat: 12.9716, lng: 77.5946 } });
    expect(r.fresh).toBe(false);
    expect(r.geoOk).toBe(false);
    const pdf = await checkEvidence(Buffer.from("%PDF-1.4 not an image"), { ...meta, captureMode: "upload" }, { db, receivedAt: Date.now(), location: null });
    expect(pdf.phash).toBeNull();
    expect(pdf.stale).toBe(true);
  });
});

describe("moveIn / moveOut (fixtures)", () => {
  it("produces a stored move-in report and never regenerates it", async () => {
    const bundleHash = await storeBundle(db, "move-in");
    const a = await runMoveIn({ leaseId: "1", bundleHash }, deps);
    expect(a.report.model).toBe("fixtures");
    expect(a.report.bundleHash).toBe(bundleHash);
    expect(a.reportHash).toBe(hashJson(a.report));
    const b = await runMoveIn({ leaseId: "1", bundleHash }, deps);
    expect(b.reportHash).toBe(a.reportHash);
  });

  it("prices findings in code: new damage from the rate card, normal wear never deductible", async () => {
    const moveIn = await runMoveIn({ leaseId: "1", bundleHash: await storeBundle(db, "move-in") }, deps);
    baselineMock.value = { status: "Agreed", baselineReportHash: moveIn.reportHash, counterEvidence: null };
    const { report } = await runMoveOut({ leaseId: "1", bundleHash: await storeBundle(db, "move-out") }, deps);
    const tile = report.findings.find((f) => f.change === "new_damage")!;
    const paint = report.findings.find((f) => f.change === "normal_wear")!;
    expect(tile).toMatchObject({ deductible: true, estimatedCostINR: 450 });
    expect(paint).toMatchObject({ deductible: false, estimatedCostINR: 0 });
    expect(report.totals).toEqual({ deductibleINR: 450, findings: 4 });
    expect(report.findings.map((f) => f.findingId)).toEqual(["f1", "f2", "f3", "f4"]);
  });

  it("caps confidence at 0.5 when the baseline was contested", async () => {
    const moveIn = await runMoveIn({ leaseId: "1", bundleHash: await storeBundle(db, "move-in") }, deps);
    baselineMock.value = { status: "Contested", baselineReportHash: moveIn.reportHash, counterEvidence: null };
    const { report } = await runMoveOut({ leaseId: "1", bundleHash: await storeBundle(db, "move-out") }, deps);
    expect(Math.max(...report.findings.map((f) => f.confidence))).toBeLessThanOrEqual(0.5);
  });
});
