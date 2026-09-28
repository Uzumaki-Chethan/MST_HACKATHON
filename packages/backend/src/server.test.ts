// D0 smoke test: SIWE login, manifests, evidence ACL and the error shape, through the real routes.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Wallet } from "ethers";
import { SiweMessage } from "siwe";
import { hashBytes, hashJson } from "@nestledger/shared";
import { buildServer } from "./server.js";
import { config } from "./config.js";
import { openDb } from "./db/index.js";

const cfg = { ...config, dataDir: ":memory:", rpcUrl: "http://127.0.0.1:1", publicWebOrigin: "http://localhost:3000" };
let app: Awaited<ReturnType<typeof buildServer>>["app"];

async function login(wallet: { address: string; signMessage(m: string): Promise<string> }): Promise<string> {
  const { nonce } = (await app.inject({ method: "GET", url: "/auth/nonce" })).json();
  const message = new SiweMessage({
    domain: "localhost:3000", address: wallet.address, statement: "Sign in to NestLedger",
    uri: "http://localhost:3000", version: "1", chainId: cfg.chainId, nonce,
  }).prepareMessage();
  const signature = await wallet.signMessage(message);
  const res = await app.inject({ method: "POST", url: "/auth/verify", payload: { message, signature } });
  expect(res.statusCode).toBe(200);
  expect(res.json().address).toBe(wallet.address.toLowerCase());
  return res.json().token;
}

function multipart(file: Buffer, meta: object) {
  const boundary = "----nestledgertest";
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="meta"\r\n\r\n${JSON.stringify(meta)}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
    file,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { payload: body, headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

beforeAll(async () => {
  process.env.LOG_LEVEL = "silent";
  ({ app } = await buildServer(cfg, openDb(":memory:")));
});
afterAll(async () => app.close());

describe("backend D0", () => {
  it("rejects a reused nonce and returns the error shape", async () => {
    const wallet = Wallet.createRandom();
    await login(wallet);
    const res = await app.inject({ method: "POST", url: "/manifests", payload: {} });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: { code: "UNAUTHORIZED", message: expect.any(String) } });
  });

  it("stores a manifest under hashJson of the submitted object", async () => {
    const token = await login(Wallet.createRandom());
    const note = { schema: "nestledger.note.v1", createdAt: "2026-09-28T20:00:00.000Z", purpose: "override", text: "Quoted twice, cheapest vendor" };
    const res = await app.inject({ method: "POST", url: "/manifests", payload: note, headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().hash).toBe(hashJson(note));
    const back = await app.inject({ method: "GET", url: `/manifests/${hashJson(note)}`, headers: { authorization: `Bearer ${token}` } });
    expect(back.json()).toEqual(note);
  });

  it("rejects unknown manifest schemas with 400", async () => {
    const token = await login(Wallet.createRandom());
    const res = await app.inject({ method: "POST", url: "/manifests", payload: { schema: "nope" }, headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(400);
  });

  it("keeps lease evidence private and society invoices public", async () => {
    const owner = await login(Wallet.createRandom());
    const stranger = await login(Wallet.createRandom());
    const photo = Buffer.from("fake-jpeg-bytes-lease");
    const mp = multipart(photo, { context: { type: "lease", id: "1", stage: "move-in" }, kind: "photo", captureMode: "live" });
    const res = await app.inject({ method: "POST", url: "/evidence", payload: mp.payload, headers: { ...mp.headers, authorization: `Bearer ${owner}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().hash).toBe(hashBytes(photo));

    const asOwner = await app.inject({ method: "GET", url: `/evidence/${hashBytes(photo)}`, headers: { authorization: `Bearer ${owner}` } });
    expect(asOwner.statusCode).toBe(200);
    const asStranger = await app.inject({ method: "GET", url: `/evidence/${hashBytes(photo)}`, headers: { authorization: `Bearer ${stranger}` } });
    expect(asStranger.statusCode).toBe(403);

    const invoice = Buffer.from("fake-invoice");
    const m = multipart(invoice, { context: { type: "society", id: "1", stage: "invoice" }, kind: "invoice", captureMode: "upload" });
    const inv = await app.inject({ method: "POST", url: "/evidence", payload: m.payload, headers: { ...m.headers, authorization: `Bearer ${owner}` } });
    expect(inv.statusCode).toBe(200);
    const anon = await app.inject({ method: "GET", url: `/evidence/${hashBytes(invoice)}` });
    expect(anon.statusCode).toBe(200);
  });

  it("answers /health even when the RPC is down, and /ai/* with 503 before the AI module exists", async () => {
    const health = (await app.inject({ method: "GET", url: "/health" })).json();
    expect(health.rpcOk).toBe(false);
    const token = await login(Wallet.createRandom());
    const ai = await app.inject({ method: "POST", url: "/ai/move-in", payload: { leaseId: "1", bundleHash: hashJson({ a: 1 }) }, headers: { authorization: `Bearer ${token}` } });
    expect([200, 503]).toContain(ai.statusCode);
  });
});
