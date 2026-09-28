// SPEC §7.5 indexer: polls eth_getLogs for every deployed NestLedger contract, stores decoded events
// in `events`, and emits each new one on an in-process EventEmitter (consumed by the AI agent, §6.8).
import { EventEmitter } from "node:events";
import { Interface, type Log } from "ethers";
import { addresses, DEPLOY_BLOCK, type ContractName } from "@nestledger/shared";
import * as abis from "@nestledger/shared";
import type { Db } from "../db/index.js";
import type { IndexedEvent, IndexerEvents } from "./types.js";

const POLL_MS = 4_000;
const MAX_RANGE = 2_000;
const MAX_BACKOFF_MS = 30_000;

/** The subset of an ethers provider the indexer needs (lets tests pass a fake). */
export type LogSource = {
  getBlockNumber(): Promise<number>;
  getLogs(filter: { address: string[]; fromBlock: number; toBlock: number }): Promise<Log[]>;
  getBlock(n: number): Promise<{ timestamp: number } | null>;
};

const ABI_OF: Record<ContractName, readonly unknown[]> = {
  NestRegistry: abis.nestRegistryAbi,
  NestPassport: abis.nestPassportAbi,
  RentalEscrow: abis.rentalEscrowAbi,
  MilestoneEscrow: abis.milestoneEscrowAbi,
  DisputeResolver: abis.disputeResolverAbi,
  SocietyLedger: abis.societyLedgerAbi,
  TankerTrust: abis.tankerTrustAbi,
};

/** Primary / secondary lookup ids, first match wins (SPEC §7.5 k1/k2). */
const K1_ARGS = ["leaseId", "id", "proposalId", "orderId", "disputeId", "flatId", "societyId", "user", "holder", "device", "arbiter"];
const K2_ARGS = ["idx", "trancheIdx", "coId", "periodIndex", "societyId", "agreementId"];

/** bigint → decimal string, address → lowercase, arrays element-wise (SPEC §6.8). */
export function serializeArg(v: unknown): string | string[] {
  if (Array.isArray(v)) return v.map((x) => serializeArg(x) as string);
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "string") return /^0x[0-9a-fA-F]{40}$/.test(v) ? v.toLowerCase() : v;
  return String(v);
}

export type Watched = { name: ContractName; address: string; iface: Interface };

export function watchedContracts(chainId: number, override?: Partial<Record<ContractName, string>>): Watched[] {
  const deployed = override ?? addresses[chainId] ?? {};
  return (Object.entries(deployed) as [ContractName, string][])
    .filter(([, a]) => !!a)
    .map(([name, address]) => ({ name, address: address.toLowerCase(), iface: new Interface(ABI_OF[name] as never) }));
}

export function decodeLog(log: Log, byAddress: Map<string, Watched>, timestamp: number): IndexedEvent | null {
  const w = byAddress.get(log.address.toLowerCase());
  if (!w) return null;
  const parsed = w.iface.parseLog({ topics: [...log.topics], data: log.data });
  if (!parsed) return null;
  const args: Record<string, string | string[]> = {};
  parsed.fragment.inputs.forEach((input, i) => {
    args[input.name || `arg${i}`] = serializeArg(parsed.args[i]);
  });
  return {
    contract: w.name, name: parsed.name, args,
    blockNumber: log.blockNumber, txHash: log.transactionHash, logIndex: log.index, timestamp,
  };
}

function keyOf(args: Record<string, string | string[]>, names: string[], skip?: string): string | null {
  for (const n of names) {
    if (n !== skip && typeof args[n] === "string") return args[n] as string;
  }
  return null;
}

/**
 * Indexed events, the block cursor and keeper/agent job keys belong to one deployment. When the
 * contracts (or their deploy block) change, e.g. after a testnet redeploy, start over from the new
 * DEPLOY_BLOCK instead of resuming the old cursor. Content-addressed data (evidence, manifests,
 * reports) is kept: it stays valid across deployments.
 */
export function resetOnNewDeployment(db: Db, chainId: number, watched: Watched[], firstBlock: number, log: (m: string) => void) {
  const fingerprint = JSON.stringify({ chainId, firstBlock, contracts: watched.map((w) => `${w.name}:${w.address}`).sort() });
  const stored = db.get<{ value: string }>("SELECT value FROM kv WHERE key = ?", ["deployment"])?.value;
  if (stored === fingerprint) return;
  db.transaction(() => {
    if (stored !== undefined) {
      db.run("DELETE FROM events");
      db.run("DELETE FROM indexer_state");
      db.run("DELETE FROM jobs");
    }
    db.run("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", ["deployment", fingerprint]);
  });
  if (stored !== undefined) log(`new deployment detected: cleared indexed events and jobs, re-indexing from block ${firstBlock}`);
}

export type Indexer = { events: IndexerEvents; start(): void; stop(): void; pollOnce(): Promise<number> };

export function startIndexer(opts: {
  db: Db; source: LogSource; chainId: number; startBlock?: number; autoStart?: boolean; log?: (m: string) => void;
  /** Contract addresses to watch; defaults to @nestledger/shared addresses[chainId]. */
  contracts?: Partial<Record<ContractName, string>>;
}): Indexer {
  const { db, source, chainId } = opts;
  const log = opts.log ?? ((m) => console.log(`[indexer] ${m}`));
  const events = new EventEmitter() as IndexerEvents;
  events.setMaxListeners(50);
  const watched = watchedContracts(chainId, opts.contracts);
  const byAddress = new Map(watched.map((w) => [w.address, w]));
  const blockTimes = new Map<number, number>();
  const firstBlock = opts.startBlock ?? DEPLOY_BLOCK[chainId] ?? 0;

  let stopped = false;
  let checkedDeployment = false; // done on the first poll, so an indexer that never polls never clears anything
  let timer: NodeJS.Timeout | undefined;
  let backoff = POLL_MS;

  async function timestampOf(n: number): Promise<number> {
    const hit = blockTimes.get(n);
    if (hit !== undefined) return hit;
    const b = await source.getBlock(n);
    const ts = b?.timestamp ?? 0;
    blockTimes.set(n, ts);
    if (blockTimes.size > 5_000) blockTimes.clear();
    return ts;
  }

  /** Indexes up to MAX_RANGE blocks. Returns how many new events were stored. */
  async function pollOnce(): Promise<number> {
    if (watched.length === 0) return 0;
    if (!checkedDeployment) {
      resetOnNewDeployment(db, chainId, watched, firstBlock, log);
      checkedDeployment = true;
    }
    const state = db.get<{ last_block: number }>("SELECT last_block FROM indexer_state WHERE id = 1");
    const from = state ? state.last_block + 1 : firstBlock;
    const latest = await source.getBlockNumber();
    if (from > latest) return 0;
    const to = Math.min(latest, from + MAX_RANGE - 1);

    const logs = await source.getLogs({ address: watched.map((w) => w.address), fromBlock: from, toBlock: to });
    logs.sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index);
    const decoded: IndexedEvent[] = [];
    for (const l of logs) {
      const e = decodeLog(l, byAddress, await timestampOf(l.blockNumber));
      if (e) decoded.push(e);
    }

    // Store the batch and advance the cursor atomically: blocks are never skipped or half-indexed.
    const fresh = db.transaction(() => {
      const out: IndexedEvent[] = [];
      for (const e of decoded) {
        const k1 = keyOf(e.args, K1_ARGS);
        const k2 = keyOf(e.args, K2_ARGS, k1 === e.args.societyId ? "societyId" : undefined);
        const r = db.run(
          `INSERT OR IGNORE INTO events (contract, name, block, tx_hash, log_index, ts, args_json, k1, k2)
           VALUES (?,?,?,?,?,?,?,?,?)`,
          [e.contract, e.name, e.blockNumber, e.txHash, e.logIndex, e.timestamp, JSON.stringify(e.args), k1, k2],
        );
        if (r.changes > 0) out.push(e);
      }
      db.run("INSERT INTO indexer_state (id, last_block) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET last_block = excluded.last_block", [to]);
      return out;
    });

    for (const e of fresh) {
      try {
        events.emit("event", e);
      } catch (err) {
        log(`listener failed on ${e.contract}.${e.name}: ${(err as Error).message}`);
      }
    }
    if (fresh.length) log(`blocks ${from}-${to}: ${fresh.length} new event(s)`);
    return fresh.length;
  }

  async function loop() {
    if (stopped) return;
    try {
      // Catch up in large steps, then settle into the normal poll interval.
      let caughtUp = false;
      while (!caughtUp && !stopped) {
        const before = db.get<{ last_block: number }>("SELECT last_block FROM indexer_state WHERE id = 1")?.last_block;
        await pollOnce();
        const after = db.get<{ last_block: number }>("SELECT last_block FROM indexer_state WHERE id = 1")?.last_block;
        caughtUp = before === after;
      }
      backoff = POLL_MS;
    } catch (err) {
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
      log(`RPC error, retrying in ${backoff / 1000}s: ${(err as Error).message}`);
    }
    if (!stopped) timer = setTimeout(loop, backoff);
  }

  if (watched.length === 0) log(`no contracts deployed on chain ${chainId}; indexer idle`);
  else log(`watching ${watched.map((w) => w.name).join(", ")} from block ${firstBlock}`);
  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    void loop();
  };
  if (opts.autoStart) start();

  return {
    events,
    start,
    pollOnce,
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
