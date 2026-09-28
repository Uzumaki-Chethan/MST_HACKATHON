// SPEC §7.2 Sign-In with Ethereum → 12 h JWT sent as `Authorization: Bearer`.
import crypto from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import jwt from "jsonwebtoken";
import { SiweMessage } from "siwe";
import { z } from "zod";
import type { Config } from "../config.js";
import type { Db } from "../db/index.js";
import { unauthorized } from "../errors.js";

const NONCE_TTL_MS = 10 * 60 * 1000;
const JWT_TTL = "12h";

let secret = "";

/** Lowercase address of the signed-in caller, or null. */
export function authUser(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  try {
    const payload = jwt.verify(header.slice(7), secret) as { sub: string };
    return payload.sub;
  } catch {
    return null;
  }
}

export function requireUser(req: FastifyRequest): string {
  const user = authUser(req);
  if (!user) throw unauthorized();
  return user;
}

export function registerAuth(app: FastifyInstance, db: Db, cfg: Config) {
  secret = cfg.jwtSecret;
  const domain = new URL(cfg.publicWebOrigin).host;

  app.get("/auth/nonce", async () => {
    const nonce = crypto.randomBytes(12).toString("hex"); // SIWE nonces must be alphanumeric, ≥ 8 chars
    db.run("DELETE FROM nonces WHERE expires_at < ?", [Date.now()]);
    db.run("INSERT INTO nonces (nonce, expires_at) VALUES (?, ?)", [nonce, Date.now() + NONCE_TTL_MS]);
    return { nonce };
  });

  app.post("/auth/verify", async (req) => {
    const body = z.object({ message: z.string(), signature: z.string() }).parse(req.body);
    let msg: SiweMessage;
    try {
      msg = new SiweMessage(body.message);
    } catch {
      throw unauthorized("Malformed sign-in message");
    }
    const stored = db.get<{ expires_at: number }>("SELECT expires_at FROM nonces WHERE nonce = ?", [msg.nonce]);
    if (!stored || stored.expires_at < Date.now()) throw unauthorized("Sign-in nonce expired; try again");
    db.run("DELETE FROM nonces WHERE nonce = ?", [msg.nonce]); // single use
    if (msg.chainId !== cfg.chainId) throw unauthorized(`Wrong chain; expected ${cfg.chainId}`);

    const result = await msg.verify({ signature: body.signature, domain, nonce: msg.nonce }, { suppressExceptions: true });
    if (!result.success) throw unauthorized("Signature check failed");

    const address = msg.address.toLowerCase();
    const token = jwt.sign({ sub: address }, secret, { expiresIn: JWT_TTL });
    return { token, address };
  });
}
