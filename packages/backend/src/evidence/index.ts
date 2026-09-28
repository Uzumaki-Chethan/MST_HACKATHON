// SPEC §7.3 POST /evidence, GET /evidence/:hash.
import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { hashBytes, isHex32 } from "@nestledger/shared";
import type { ChainClients } from "../chain/index.js";
import type { Db } from "../db/index.js";
import { authUser, requireUser } from "../auth/index.js";
import { badRequest, forbidden, notFound } from "../errors.js";
import type { AiModule } from "../aiModule.js";
import { canRead, contextIsPublic } from "./acl.js";

export const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;

export const EvidenceMetaSchema = z.object({
  context: z.object({
    type: z.enum(["lease", "project", "proposal", "order", "society"]),
    id: z.string(),
    stage: z.string(),
  }),
  kind: z.enum(["photo", "invoice", "design", "document"]),
  room: z.string().optional(),
  vantageId: z.string().optional(),
  captureMode: z.enum(["live", "upload"]),
  capturedAt: z.string().optional(),
  geo: z.object({ lat: z.number(), lng: z.number(), acc: z.number() }).optional(),
});
export type EvidenceMeta = z.infer<typeof EvidenceMetaSchema>;

type EvidenceRow = {
  hash: string; mime: string; size: number; path: string; phash: string | null; uploader: string;
  context_type: string; context_id: string; checks_json: string | null; is_public: number;
};

export function registerEvidence(app: FastifyInstance, db: Db, chain: ChainClients, ai: AiModule) {
  app.post("/evidence", async (req) => {
    const user = requireUser(req);
    let file: { buffer: Buffer; mime: string } | null = null;
    let metaRaw: string | null = null;
    for await (const part of req.parts({ limits: { fileSize: MAX_EVIDENCE_BYTES, files: 1 } })) {
      if (part.type === "file") {
        const buffer = await part.toBuffer();
        if (part.file.truncated) throw badRequest("File is larger than 10 MB");
        file = { buffer, mime: part.mimetype };
      } else if (part.fieldname === "meta") {
        metaRaw = String(part.value);
      }
    }
    if (!file) throw badRequest("Missing file");
    if (!metaRaw) throw badRequest("Missing meta");
    const meta = EvidenceMetaSchema.parse(JSON.parse(metaRaw));

    const hash = hashBytes(file.buffer);
    const existing = db.get<EvidenceRow>("SELECT * FROM evidence WHERE hash = ?", [hash]);
    if (existing) return toResponse(existing);

    const filePath = path.join(db.evidenceDir, hash);
    fs.writeFileSync(filePath, file.buffer);

    // Integrity checks are Laptop 2's checkEvidence (SPEC §6.5); they never block an upload.
    let checks: Record<string, unknown> | null = null;
    if (ai.checkEvidence) {
      try {
        checks = await ai.checkEvidence(file.buffer, meta, { db, receivedAt: Date.now(), location: null });
      } catch (err) {
        console.warn("[evidence] checkEvidence failed:", (err as Error).message);
      }
    }
    const isPublic = meta.kind === "invoice" || contextIsPublic(meta.context.type) ? 1 : 0;
    const row: EvidenceRow = {
      hash, mime: file.mime, size: file.buffer.length, path: filePath,
      phash: (checks?.phash as string | null | undefined) ?? null, uploader: user,
      context_type: meta.context.type, context_id: meta.context.id,
      checks_json: checks ? JSON.stringify(checks) : null, is_public: isPublic,
    };
    db.run(
      `INSERT INTO evidence (hash, mime, size, path, phash, uploader, context_type, context_id, stage,
         meta_json, checks_json, is_public, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [row.hash, row.mime, row.size, row.path, row.phash, row.uploader, row.context_type, row.context_id,
        meta.context.stage, JSON.stringify(meta), row.checks_json, row.is_public, Date.now()],
    );
    return toResponse(row);
  });

  app.get<{ Params: { hash: string } }>("/evidence/:hash", async (req, reply) => {
    const hash = req.params.hash.toLowerCase();
    if (!isHex32(hash)) throw badRequest("Bad hash");
    const row = db.get<EvidenceRow>("SELECT * FROM evidence WHERE hash = ?", [hash]);
    if (!row) throw notFound("No such file");
    const ok = await canRead(chain, {
      type: row.context_type, id: row.context_id, uploader: row.uploader, isPublic: !!row.is_public,
    }, authUser(req));
    if (!ok) throw forbidden("You are not a party to this evidence");
    return reply.type(row.mime).send(fs.createReadStream(row.path));
  });
}

function toResponse(row: EvidenceRow) {
  return {
    hash: row.hash, mime: row.mime, size: row.size, phash: row.phash,
    checks: row.checks_json ? JSON.parse(row.checks_json) : null,
    url: `/evidence/${row.hash}`,
  };
}
