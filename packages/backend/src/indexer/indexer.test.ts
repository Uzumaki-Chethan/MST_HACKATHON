// D1: the indexer stores events in the exact shape the AI agent (Laptop 2) reads, and serves /timeline and /me/flats.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Interface, Wallet, type Log } from "ethers";
import { SiweMessage } from "siwe";
import { rentalEscrowAbi, societyLedgerAbi } from "@nestledger/shared";
import { openDb, type Db } from "../db/index.js";
import { startIndexer, type LogSource } from "./index.js";
import type { IndexedEvent } from "./types.js";
import { buildServer } from "../server.js";
import { config } from "../config.js";

const RENTAL = "0x00000000000000000000000000000000000000aa";
const LEDGER = "0x00000000000000000000000000000000000000bb";
const rental = new Interface(rentalEscrowAbi as never);
const ledger = new Interface(societyLedgerAbi as never);
const owner = Wallet.createRandom();

function makeLog(iface: Interface, address: string, name: string, args: unknown[], blockNumber: number, index: number): Log {
  const { topics, data } = iface.encodeEventLog(name, args);
  return { address, topics, data, blockNumber, index, transactionHash: `0x${String(blockNumber * 100 + index).padStart(64, "0")}` } as unknown as Log;
}

const LOGS: Log[] = [
  makeLog(rental, RENTAL, "ClaimSubmitted", [7n, 0, 0, [0n, 450_000_000_000_000n], "0x" + "ab".repeat(32), false], 101, 0),
  makeLog(rental, RENTAL, "LeaseSigned", [7n, owner.address, 180n, 1_790_000_000n], 100, 3),
  makeLog(ledger, LEDGER, "FlatAdded", [1n, 4n, "B-304", owner.address, 10, 2_000_000_000_000_000n], 102, 1),
];

function fakeSource(latest: number): LogSource & { calls: number } {
  const src = {
    calls: 0,
    getBlockNumber: async () => latest,
    getLogs: async ({ fromBlock, toBlock }: { fromBlock: number; toBlock: number }) => {
      src.calls++;
      return LOGS.filter((l) => l.blockNumber >= fromBlock && l.blockNumber <= toBlock);
    },
    getBlock: async (n: number) => ({ timestamp: 1_790_000_000 + n }),
  };
  return src;
}

describe("indexer", () => {
  let db: Db;
  const seen: IndexedEvent[] = [];

  beforeAll(async () => {
    db = openDb(":memory:");
    const ix = startIndexer({
      db, source: fakeSource(150), chainId: 31337, startBlock: 90, log: () => {},
      contracts: { RentalEscrow: RENTAL, SocietyLedger: LEDGER },
    });
    ix.events.on("event", (e) => seen.push(e));
    expect(await ix.pollOnce()).toBe(3);
    expect(await ix.pollOnce()).toBe(0); // caught up, nothing new, nothing duplicated
  });

  it("emits events in block order with the SPEC §6.8 IndexedEvent shape", () => {
    expect(seen.map((e) => `${e.contract}.${e.name}`)).toEqual([
      "RentalEscrow.LeaseSigned", "RentalEscrow.ClaimSubmitted", "SocietyLedger.FlatAdded",
    ]);
    const claim = seen[1];
    expect(claim.args).toEqual({
      id: "7", idx: "0", round: "0", items: ["0", "450000000000000"],
      evidenceHash: "0x" + "ab".repeat(32), late: "false",
    });
    expect(claim.blockNumber).toBe(101);
    expect(claim.timestamp).toBe(1_790_000_101);
    expect(seen[0].args.tenant).toBe(owner.address.toLowerCase()); // addresses lowercase
  });

  it("stores rows the agent's backfill can query, with k1/k2 lookup ids", () => {
    const row = db.get<{ args_json: string; k1: string; k2: string }>(
      "SELECT args_json, k1, k2 FROM events WHERE contract = 'RentalEscrow' AND name = 'ClaimSubmitted'");
    expect(JSON.parse(row!.args_json).items).toEqual(["0", "450000000000000"]);
    expect(row!.k1).toBe("7");
    expect(row!.k2).toBe("0");
    const flat = db.get<{ k1: string; k2: string }>("SELECT k1, k2 FROM events WHERE name = 'FlatAdded'");
    expect(flat).toEqual({ k1: "4", k2: "1" }); // flatId, societyId
    expect(db.get<{ last_block: number }>("SELECT last_block FROM indexer_state")!.last_block).toBe(150);
  });

  describe("routes", () => {
    let app: Awaited<ReturnType<typeof buildServer>>["app"];
    beforeAll(async () => {
      process.env.LOG_LEVEL = "silent";
      ({ app } = await buildServer({ ...config, dataDir: ":memory:", rpcUrl: "http://127.0.0.1:1" }, db));
    });
    afterAll(async () => app.close());

    it("GET /timeline/rental/:id returns that lease's history", async () => {
      const res = await app.inject({ method: "GET", url: "/timeline/rental/7" });
      expect(res.statusCode).toBe(200);
      expect(res.json().map((e: { name: string }) => e.name)).toEqual(["LeaseSigned", "ClaimSubmitted"]);
      expect(res.json()[1]).toMatchObject({ txHash: expect.stringMatching(/^0x/), blockNumber: 101, timestamp: 1_790_000_101 });
      expect((await app.inject({ method: "GET", url: "/timeline/nope/7" })).statusCode).toBe(400);
    });

    it("GET /me/flats lists the caller's flats", async () => {
      const { nonce } = (await app.inject({ method: "GET", url: "/auth/nonce" })).json();
      const message = new SiweMessage({
        domain: new URL(config.publicWebOrigin).host, address: owner.address, uri: config.publicWebOrigin,
        version: "1", chainId: config.chainId, nonce,
      }).prepareMessage();
      const { token } = (await app.inject({
        method: "POST", url: "/auth/verify", payload: { message, signature: await owner.signMessage(message) },
      })).json();
      const res = await app.inject({ method: "GET", url: "/me/flats", headers: { authorization: `Bearer ${token}` } });
      expect(res.json()).toEqual([{ flatId: "4", societyId: "1", label: "B-304", maintenanceWei: "2000000000000000" }]);
    });
  });
});
