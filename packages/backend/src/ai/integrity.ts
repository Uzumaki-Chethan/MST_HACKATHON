// SPEC §6.5 — evidence integrity checks. Never blocks an upload; results become UI badges,
// LLM hints, and 0 support for claim items whose photos are reused or not fresh.
import exifr from "exifr";
import sharp from "sharp";
import { bmvbhash } from "blockhash-core";
import { hashBytes } from "@nestledger/shared";
import type { Db } from "../db/index.js";

export type EvidenceMeta = {
  context: { type: string; id: string; stage: string };
  kind: string;
  room?: string;
  vantageId?: string;
  captureMode: "live" | "upload";
  capturedAt?: string;
  geo?: { lat: number; lng: number; acc: number };
};

export type IntegrityResult = {
  hash: string;
  phash: string | null;
  duplicateOf?: string;
  reusedOf?: string;
  nearDuplicateOf?: string;
  fresh?: boolean;
  exifTime?: string | null;
  stale?: boolean;
  geoOk: boolean | null;
};

export type IntegrityCtx = { db: Db; receivedAt: number; location: { lat: number; lng: number } | null };

const FRESH_MS = 5 * 60_000;
const EXIF_MAX_AGE_MS = 24 * 3600_000;
const GEOFENCE_M = 200;

/** 64-bit blockhash of a greyscale, fixed-size copy of the image. Null for non-images. */
export async function perceptualHash(file: Buffer): Promise<string | null> {
  try {
    const { data, info } = await sharp(file)
      .rotate()
      .greyscale()
      .resize(256, 256, { fit: "fill" })
      .toColourspace("srgb")
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return bmvbhash({ width: info.width, height: info.height, data }, 8);
  } catch {
    return null;
  }
}

export function hamming(a: string, b: string): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
}

export function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export async function checkEvidence(file: Buffer, meta: EvidenceMeta, ctx: IntegrityCtx): Promise<IntegrityResult> {
  const hash = hashBytes(file);
  const result: IntegrityResult = { hash, phash: null, geoOk: null };

  const dup = ctx.db.get<{ hash: string }>("SELECT hash FROM evidence WHERE hash = ?", [hash]);
  if (dup) result.duplicateOf = dup.hash;

  result.phash = await perceptualHash(file);
  // Only photos are compared, and only with other photos: invoices from one template and design references
  // look alike by construction and would be false "reused" hits.
  if (result.phash && meta.kind === "photo") {
    let best: { hash: string; d: number } | null = null;
    for (const row of ctx.db.query<{ hash: string; phash: string }>(
      "SELECT hash, phash FROM evidence WHERE phash IS NOT NULL AND hash != ? AND coalesce(json_extract(meta_json, '$.kind'), 'photo') = 'photo'",
      [hash],
    )) {
      if (row.phash.length !== result.phash.length) continue;
      const d = hamming(row.phash, result.phash);
      if (!best || d < best.d) best = { hash: row.hash, d };
    }
    if (best && best.d <= 2) result.reusedOf = best.hash;
    else if (best && best.d <= 6) result.nearDuplicateOf = best.hash;
  }

  if (meta.captureMode === "live") {
    const t = meta.capturedAt ? Date.parse(meta.capturedAt) : NaN;
    result.fresh = !Number.isNaN(t) && Math.abs(ctx.receivedAt - t) <= FRESH_MS;
  } else {
    let exifTime: Date | null = null;
    try {
      const exif = await exifr.parse(file, ["DateTimeOriginal"]);
      if (exif?.DateTimeOriginal instanceof Date) exifTime = exif.DateTimeOriginal;
    } catch {
      // unreadable EXIF counts as missing
    }
    result.exifTime = exifTime ? exifTime.toISOString() : null;
    result.stale = !exifTime || ctx.receivedAt - exifTime.getTime() > EXIF_MAX_AGE_MS;
  }

  if (meta.geo && ctx.location) result.geoOk = haversineMeters(meta.geo, ctx.location) <= GEOFENCE_M;

  return result;
}

/** A photo that must not earn AI support (SPEC §6.5 consequences). */
export function isTainted(checks: Partial<IntegrityResult> | null | undefined): boolean {
  if (!checks) return false;
  return !!checks.reusedOf || checks.fresh === false || checks.stale === true;
}
