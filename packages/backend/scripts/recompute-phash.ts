// One-off maintenance: recompute every stored evidence pHash with the fixed perceptualHash (lap2/qa-fixes),
// then redo each photo's reuse checks (reusedOf / nearDuplicateOf) against the photos stored BEFORE it,
// exactly as checkEvidence did at upload time. Other checks (freshness, EXIF, geofence, duplicateOf) are kept.
// Stop the backend first. Run: pnpm --filter @nestledger/backend exec tsx scripts/recompute-phash.ts
import fs from "node:fs";
import { config } from "../src/config.js";
import { openDb } from "../src/db/index.js";
import { hamming, perceptualHash } from "../src/ai/integrity.js";

type Row = { hash: string; path: string; meta_json: string; checks_json: string | null; created_at: number };

const db = openDb(config.dataDir);
const rows = db.query<Row>("SELECT hash, path, meta_json, checks_json, created_at FROM evidence ORDER BY created_at, rowid");
const isPhoto = (r: Row) => (JSON.parse(r.meta_json).kind ?? "photo") === "photo";

const phash = new Map<string, string | null>();
for (const r of rows) phash.set(r.hash, fs.existsSync(r.path) ? await perceptualHash(fs.readFileSync(r.path)) : null);

let changed = 0;
const earlierPhotos: Row[] = [];
for (const r of rows) {
  const checks = r.checks_json ? JSON.parse(r.checks_json) : {};
  const p = phash.get(r.hash) ?? null;
  const before = JSON.stringify([checks.phash ?? null, checks.reusedOf ?? null, checks.nearDuplicateOf ?? null]);
  checks.phash = p;
  delete checks.reusedOf;
  delete checks.nearDuplicateOf;
  if (p && isPhoto(r)) {
    let best: { hash: string; d: number } | null = null;
    for (const e of earlierPhotos) {
      const q = phash.get(e.hash);
      if (!q || q.length !== p.length) continue;
      const d = hamming(q, p);
      if (!best || d < best.d) best = { hash: e.hash, d };
    }
    if (best && best.d <= 2) checks.reusedOf = best.hash;
    else if (best && best.d <= 6) checks.nearDuplicateOf = best.hash;
  }
  if (isPhoto(r)) earlierPhotos.push(r);
  if (JSON.stringify([checks.phash, checks.reusedOf ?? null, checks.nearDuplicateOf ?? null]) !== before) changed++;
  db.run("UPDATE evidence SET phash = ?, checks_json = ? WHERE hash = ?", [p, JSON.stringify(checks), r.hash]);
}

const count = (sql: string) => db.get<{ n: number }>(sql)!.n;
console.log(`${rows.length} evidence rows, ${changed} changed`);
console.log(`photos flagged reused now: ${count("SELECT count(*) n FROM evidence WHERE json_extract(checks_json,'$.reusedOf') IS NOT NULL")}, near-duplicate: ${count("SELECT count(*) n FROM evidence WHERE json_extract(checks_json,'$.nearDuplicateOf') IS NOT NULL")}`);
