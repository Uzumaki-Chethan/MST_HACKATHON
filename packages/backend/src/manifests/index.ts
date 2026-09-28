// SPEC §7.3 POST/GET /manifests and GET /reports/:hash.
import type { FastifyInstance } from "fastify";
import { hashJson, isHex32 } from "@nestledger/shared";
import { parseManifest } from "@nestledger/shared/schemas";
import type { ChainClients } from "../chain/index.js";
import type { Db } from "../db/index.js";
import { authUser, requireUser } from "../auth/index.js";
import { badRequest, forbidden, notFound } from "../errors.js";
import { canRead, contextIsPublic } from "../evidence/acl.js";

/** Which access-control context a manifest belongs to (SPEC §7.6). */
export function manifestContext(m: Record<string, any>): { type: string | null; id: string | null } {
  switch (m.schema) {
    case "nestledger.bundle.v1": return { type: m.context.type, id: m.context.id };
    case "nestledger.claim.rental.v1": return { type: "lease", id: m.leaseId };
    case "nestledger.claim.milestone.v1": return { type: "project", id: m.projectId };
    case "nestledger.invoice.v1": return { type: "society", id: m.societyId };
    case "nestledger.society.v1": return { type: "society", id: null };
    default: return { type: null, id: null }; // lease terms, specs, notes, profiles: uploader + signed-in users
  }
}

type StoredRow = { json: string; uploader?: string; context_type: string | null; context_id: string | null; is_public: number };

export function registerManifests(app: FastifyInstance, db: Db, chain: ChainClients) {
  app.post("/manifests", async (req) => {
    const user = requireUser(req);
    const body = req.body as Record<string, unknown>;
    try {
      parseManifest(body);
    } catch (err) {
      if ((err as Error).name === "ZodError") throw err;
      throw badRequest((err as Error).message);
    }
    // Hash exactly what the client sent: the client computes the same hashJson() for the on-chain call.
    const hash = hashJson(body);
    const ctx = manifestContext(body);
    db.run(
      `INSERT OR IGNORE INTO manifests (hash, schema, json, uploader, context_type, context_id, is_public, created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      [hash, body.schema, JSON.stringify(body), user, ctx.type, ctx.id, contextIsPublic(ctx.type) ? 1 : 0, Date.now()],
    );
    return { hash };
  });

  app.get<{ Params: { hash: string } }>("/manifests/:hash", async (req) => {
    const row = readRow(db, "manifests", req.params.hash);
    await assertReadable(chain, row, authUser(req));
    return JSON.parse(row.json);
  });

  app.get<{ Params: { hash: string } }>("/reports/:hash", async (req) => {
    const row = readRow(db, "reports", req.params.hash);
    await assertReadable(chain, row, authUser(req));
    return JSON.parse(row.json);
  });
}

function readRow(db: Db, table: "manifests" | "reports", rawHash: string): StoredRow {
  const hash = rawHash.toLowerCase();
  if (!isHex32(hash)) throw badRequest("Bad hash");
  const row = db.get<StoredRow>(`SELECT * FROM ${table} WHERE hash = ?`, [hash]);
  if (!row) throw notFound();
  return row;
}

async function assertReadable(chain: ChainClients, row: StoredRow, user: string | null) {
  const ok = await canRead(chain, {
    type: row.context_type, id: row.context_id, uploader: row.uploader ?? null, isPublic: !!row.is_public,
  }, user);
  if (!ok) throw forbidden("You are not a party to this record");
}
