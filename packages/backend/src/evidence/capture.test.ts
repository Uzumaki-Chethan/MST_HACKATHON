// D2 QR capture handoff: phone uploads with X-Capture-Token, scoped to one context; desktop polls.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Wallet } from "ethers";
import { SiweMessage } from "siwe";
import { hashBytes } from "@nestledger/shared";
import { buildServer } from "../server.js";
import { config } from "../config.js";
import { openDb } from "../db/index.js";

let app: Awaited<ReturnType<typeof buildServer>>["app"];

async function login(wallet: { address: string; signMessage(m: string): Promise<string> }) {
  const { nonce } = (await app.inject({ method: "GET", url: "/auth/nonce" })).json();
  const message = new SiweMessage({
    domain: new URL(config.publicWebOrigin).host, address: wallet.address, uri: config.publicWebOrigin,
    version: "1", chainId: config.chainId, nonce,
  }).prepareMessage();
  return (await app.inject({ method: "POST", url: "/auth/verify", payload: { message, signature: await wallet.signMessage(message) } })).json().token as string;
}

function upload(file: Buffer, meta: object, headers: Record<string, string>) {
  const b = "----capture";
  const payload = Buffer.concat([
    Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="meta"\r\n\r\n${JSON.stringify(meta)}\r\n`),
    Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="p.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
    file, Buffer.from(`\r\n--${b}--\r\n`),
  ]);
  return app.inject({ method: "POST", url: "/evidence", payload, headers: { ...headers, "content-type": `multipart/form-data; boundary=${b}` } });
}

beforeAll(async () => {
  process.env.LOG_LEVEL = "silent";
  ({ app } = await buildServer({ ...config, dataDir: ":memory:", rpcUrl: "http://127.0.0.1:1" }, openDb(":memory:")));
});
afterAll(async () => app.close());

describe("capture sessions", () => {
  it("lets a phone upload into the session's context only, and the creator sees the uploads", async () => {
    const desktop = await login(Wallet.createRandom());
    const created = await app.inject({
      method: "POST", url: "/capture-sessions", headers: { authorization: `Bearer ${desktop}` },
      payload: { context: { type: "lease", id: "3" }, stage: "move-out", template: "compact" },
    });
    expect(created.statusCode).toBe(200);
    const { token, url } = created.json();
    expect(url).toBe(`${config.publicWebOrigin}/capture/${token}`);

    const photo = Buffer.from("phone-photo-kitchen");
    const meta = { context: { type: "lease", id: "3", stage: "move-out" }, kind: "photo", room: "kitchen", vantageId: "kitchen-counter", captureMode: "live" };
    const ok = await upload(photo, meta, { "x-capture-token": token });
    expect(ok.statusCode).toBe(200);

    const wrong = await upload(Buffer.from("other"), { ...meta, context: { type: "lease", id: "4", stage: "move-out" } }, { "x-capture-token": token });
    expect(wrong.statusCode).toBe(403);
    expect((await upload(photo, meta, { "x-capture-token": "bogus" })).statusCode).toBe(401);

    const polled = await app.inject({ method: "GET", url: `/capture-sessions/${token}`, headers: { authorization: `Bearer ${desktop}` } });
    expect(polled.json().uploads).toEqual([{ hash: hashBytes(photo), room: "kitchen", vantageId: "kitchen-counter", checks: expect.anything() }]);

    const stranger = await login(Wallet.createRandom());
    const denied = await app.inject({ method: "GET", url: `/capture-sessions/${token}`, headers: { authorization: `Bearer ${stranger}` } });
    expect(denied.statusCode).toBe(403);
  });
});
