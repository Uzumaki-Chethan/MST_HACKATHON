// SPEC §7.3 / §8.4 QR capture handoff (P1). The desktop opens a 30-minute session scoped to one
// context; the phone uploads to POST /evidence with `X-Capture-Token` (no wallet needed on the phone);
// the desktop polls GET /capture-sessions/:token for the uploads, builds the bundle and signs.
import crypto from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Config } from "../config.js";
import type { Db } from "../db/index.js";
import { requireUser } from "../auth/index.js";
import { forbidden, notFound, unauthorized } from "../errors.js";

const SESSION_TTL_MS = 30 * 60 * 1000;

export type CaptureSession = {
  token: string; creator: string; context_type: string; context_id: string; stage: string; template: string; expires_at: number;
};

const SessionBody = z.object({
  context: z.object({ type: z.enum(["lease", "project", "proposal", "order", "society"]), id: z.string() }),
  stage: z.string(),
  template: z.string().default("compact"),
});

/** The session behind an `X-Capture-Token` header, or null when the header is absent. Throws if invalid. */
export function captureSessionOf(db: Db, req: FastifyRequest): CaptureSession | null {
  const token = req.headers["x-capture-token"];
  if (typeof token !== "string" || !token) return null;
  const s = db.get<CaptureSession>("SELECT * FROM capture_sessions WHERE token = ?", [token]);
  if (!s || s.expires_at < Date.now()) throw unauthorized("Capture link expired; scan a new QR code");
  return s;
}

/** Upload must stay inside the session's context. */
export function assertInSession(s: CaptureSession, context: { type: string; id: string }) {
  if (context.type !== s.context_type || context.id !== s.context_id) throw forbidden("This capture link is for a different agreement");
}

export function recordCaptureUpload(db: Db, s: CaptureSession, hash: string) {
  db.run("INSERT OR IGNORE INTO capture_uploads (token, hash, created_at) VALUES (?, ?, ?)", [s.token, hash, Date.now()]);
}

export function registerCaptureSessions(app: FastifyInstance, db: Db, cfg: Config) {
  app.post("/capture-sessions", async (req) => {
    const user = requireUser(req);
    const body = SessionBody.parse(req.body);
    const token = crypto.randomBytes(18).toString("base64url");
    db.run(
      `INSERT INTO capture_sessions (token, creator, context_type, context_id, stage, template, expires_at)
       VALUES (?,?,?,?,?,?,?)`,
      [token, user, body.context.type, body.context.id, body.stage, body.template, Date.now() + SESSION_TTL_MS],
    );
    return { token, url: `${cfg.publicWebOrigin}/capture/${token}` };
  });

  app.get<{ Params: { token: string } }>("/capture-sessions/:token", async (req) => {
    const user = requireUser(req);
    const s = db.get<CaptureSession>("SELECT * FROM capture_sessions WHERE token = ?", [req.params.token]);
    if (!s) throw notFound("No such capture session");
    if (s.creator !== user) throw forbidden("Only the session creator can read its uploads");
    const uploads = db.query<{ hash: string; meta_json: string; checks_json: string | null }>(
      `SELECT e.hash, e.meta_json, e.checks_json FROM capture_uploads u JOIN evidence e ON e.hash = u.hash
       WHERE u.token = ? ORDER BY u.created_at`, [s.token]);
    return {
      context: { type: s.context_type, id: s.context_id }, stage: s.stage, template: s.template,
      expiresAt: new Date(s.expires_at).toISOString(),
      uploads: uploads.map((u) => {
        const meta = JSON.parse(u.meta_json);
        return { hash: u.hash, room: meta.room ?? null, vantageId: meta.vantageId ?? null, checks: u.checks_json ? JSON.parse(u.checks_json) : null };
      }),
    };
  });
}
