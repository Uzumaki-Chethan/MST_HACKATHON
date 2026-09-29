// Shared plumbing for the AI tasks: deps type, evidence loading, report storage, LLM-side clamps.
import fs from "node:fs";
import { z } from "zod";
import { hashJson, type Hex32 } from "@nestledger/shared";
import { BundleSchema, type Bundle, type BundleItem } from "@nestledger/shared/schemas";
import type { ChainClients } from "../chain/index.js";
import type { Db } from "../db/index.js";
import type { VisionLLM } from "./llm.js";
import { demoUploads, type IntegrityResult } from "./integrity.js";

export type AiDeps = { db: Db; llm: VisionLLM; chain: ChainClients };

export class NotFoundError extends Error {
  readonly code = "NOT_FOUND";
}
/** Maps to a 4xx through Laptop 1's error handler (`statusCode`). */
export class BadStateError extends Error {
  readonly statusCode = 409;
}

// §6.7: numbers the LLM produces are clamped, never trusted as-is.
export const clamp = (lo: number, hi: number) => z.number().transform((v) => Math.min(hi, Math.max(lo, v)));
export const llmConfidence = clamp(0, 1);
export const llmScore = clamp(0, 100);
export const llmQuantity = clamp(0, 1000);

export function loadManifest<T>(db: Db, hash: string, schema: z.ZodType<T>, what: string): T {
  const row = db.get<{ json: string }>("SELECT json FROM manifests WHERE hash = ?", [hash]);
  if (!row) throw new NotFoundError(`${what} ${hash} not found`);
  return schema.parse(JSON.parse(row.json));
}

export const loadBundle = (db: Db, hash: string): Bundle => loadManifest(db, hash, BundleSchema, "Bundle");

export type LoadedPhoto = { item: BundleItem; data: Buffer; checks: Partial<IntegrityResult> | null };

/** Photo items of a bundle with their bytes and the integrity checks stored at upload. */
export function loadPhotos(db: Db, bundle: Bundle): LoadedPhoto[] {
  return bundle.items
    .filter((it) => it.kind === "photo")
    .map((item) => {
      const row = db.get<{ path: string; checks_json: string | null }>(
        "SELECT path, checks_json FROM evidence WHERE hash = ?",
        [item.hash],
      );
      if (!row) throw new NotFoundError(`Evidence file ${item.hash} not found`);
      return { item, data: fs.readFileSync(row.path), checks: row.checks_json ? JSON.parse(row.checks_json) : null };
    });
}

export function integrityNote(label: string, checks: Partial<IntegrityResult> | null): string | null {
  if (!checks) return null;
  const issues = [
    checks.reusedOf && "looks reused from earlier evidence",
    checks.nearDuplicateOf && "is a near-duplicate of earlier evidence",
    checks.fresh === false && "was not captured live within 5 minutes of upload",
    checks.stale && !demoUploads() && "has missing or old EXIF time",
    checks.geoOk === false && "was taken away from the property",
  ].filter(Boolean);
  return issues.length ? `Photo ${label} ${issues.join(", ")}. Lower your confidence for anything that relies on it.` : null;
}

export function findReport<T>(db: Db, task: string, contextId: string, field: string, value: string): { report: T; reportHash: Hex32 } | null {
  const row = db.get<{ hash: string; json: string }>(
    `SELECT hash, json FROM reports WHERE task = ? AND context_id = ? AND json_extract(json, ?) = ? ORDER BY created_at DESC LIMIT 1`,
    [task, contextId, `$.${field}`, value],
  );
  return row ? { report: JSON.parse(row.json) as T, reportHash: row.hash as Hex32 } : null;
}

export function storeReport(
  db: Db,
  args: { task: string; report: { model: string; promptVersion: string }; contextType: string; contextId: string; isPublic?: boolean },
): Hex32 {
  const reportHash = hashJson(args.report);
  db.run(
    `INSERT OR IGNORE INTO reports (hash, task, json, context_type, context_id, model, prompt_version, is_public, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [reportHash, args.task, JSON.stringify(args.report), args.contextType, args.contextId, args.report.model,
      args.report.promptVersion, args.isPublic ? 1 : 0, Date.now()],
  );
  return reportHash;
}

export const chunk = <T>(xs: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(xs.length / size) }, (_, i) => xs.slice(i * size, i * size + size));
