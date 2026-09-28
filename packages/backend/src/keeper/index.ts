// SPEC §7.5 keeper: calls the permissionless timeout functions so that every deadline's default
// actually happens (N1). Every 15 s it builds candidates from indexed events, reads chain state,
// dry-runs the call (staticCall) and only sends what would succeed. One send at a time on the
// keeper wallet; `jobs` rows record what was sent. It never cancels stalled milestones (payer's choice).
import { Contract, type Wallet } from "ethers";
import {
  addresses, milestoneEscrowAbi, rentalEscrowAbi, societyLedgerAbi, tankerTrustAbi, type ContractName,
} from "@nestledger/shared";
import type { Db } from "../db/index.js";

const INTERVAL_MS = 15_000;
const TS = { Open: 1n, Claimed: 2n } as const;        // TrancheStatus
const BASELINE_SUBMITTED = 1n;                         // BaselineStatus.Submitted
const PROPOSAL = { Pending: 0n, CommitteeApproved: 1n } as const;
const ORDER = { Open: 0n, Delivering: 1n } as const;

/** One call the keeper wants to make. `key` makes it idempotent across polls. */
export type Action = { contract: ContractName; fn: string; args: bigint[]; key: string };

/** What the keeper needs from the chain (a fake in tests, ethers in production). */
export type KeeperChain = {
  now(): Promise<bigint>;
  read(contract: ContractName, fn: string, args: unknown[]): Promise<any>;
  wouldSucceed(action: Action): Promise<boolean>;
  send(action: Action): Promise<string>;
};

type Row = { k1: string };
const ids = (db: Db, contract: string, name: string): string[] =>
  db.query<Row>("SELECT DISTINCT k1 FROM events WHERE contract = ? AND name = ? AND k1 IS NOT NULL", [contract, name]).map((r) => r.k1);

/** ids that have `open` events but none of the `closed` events. */
function openIds(db: Db, contract: string, open: string, closed: string[]): string[] {
  const done = new Set(closed.flatMap((n) => ids(db, contract, n)));
  return ids(db, contract, open).filter((id) => !done.has(id));
}

/** Builds this poll's candidate actions from indexed events + current chain state (SPEC §7.5 table). */
export async function findActions(db: Db, chain: KeeperChain, deployed: Partial<Record<ContractName, string>>): Promise<Action[]> {
  const now = await chain.now();
  const out: Action[] = [];

  if (deployed.RentalEscrow) {
    const live = openIds(db, "RentalEscrow", "LeaseSigned", ["LeaseClosed"]);
    for (const id of live) {
      const L = await chain.read("RentalEscrow", "getLease", [BigInt(id)]);
      // 1. Baseline submitted and its window has passed → presumed accepted.
      if (L.baseline === BASELINE_SUBMITTED && now > BigInt(L.baselineAt) + BigInt(L.baselineWindow)) {
        out.push({ contract: "RentalEscrow", fn: "finalizeBaseline", args: [BigInt(id)], key: `baseline:${id}` });
      }
    }
    // 2. Deposit tranche Open past its claim deadline → full refund to the tenant.
    for (const id of openIds(db, "RentalEscrow", "MoveOutStarted", ["LeaseClosed"])) {
      const t = await chain.read("RentalEscrow", "getTranche", [BigInt(id), 0]);
      if (t.status === TS.Open && now > BigInt(t.claimDeadline)) {
        out.push({ contract: "RentalEscrow", fn: "finalizeNoClaim", args: [BigInt(id)], key: `noclaim:${id}` });
      }
    }
  }

  // 3. A claim is waiting and the payer stayed silent past responseWindow (rental + milestone).
  const escrows: [ContractName, string[]][] = [
    ["RentalEscrow", ["LeaseClosed"]],
    ["MilestoneEscrow", ["ProjectCompleted", "ProjectCancelled"]],
  ];
  for (const [contract, closed] of escrows) {
    if (!deployed[contract]) continue;
    for (const id of openIds(db, contract, "ClaimSubmitted", closed)) {
      const ag = await chain.read(contract, "getAgreement", [BigInt(id)]);
      const t = await chain.read(contract, "getTranche", [BigInt(id), ag.current]);
      if (t.status !== TS.Claimed) continue;
      const c = await chain.read(contract, "getClaim", [BigInt(id), ag.current]);
      if (now > BigInt(c.submittedAt) + BigInt(ag.responseWindow)) {
        out.push({ contract, fn: "finalizeAfterSilence", args: [BigInt(id)], key: `silence:${contract}:${id}:${ag.current}:${c.round}` });
      }
    }
  }

  // 4. A society proposal is executable, or its tier-2 vote has ended (execute also rejects failed votes).
  if (deployed.SocietyLedger) {
    for (const id of openIds(db, "SocietyLedger", "ProposalCreated", ["ProposalExecuted", "ProposalRejected", "ProposalCancelled"])) {
      const p = await chain.read("SocietyLedger", "getProposal", [BigInt(id)]);
      const [ok] = await chain.read("SocietyLedger", "canExecute", [BigInt(id)]);
      const voteOver = p.status === PROPOSAL.CommitteeApproved && p.voteEnds > 0n && now >= BigInt(p.voteEnds);
      if (ok || voteOver) out.push({ contract: "SocietyLedger", fn: "execute", args: [BigInt(id)], key: `execute:${id}` });
    }
  }

  // 5. A tanker order is past its delivery deadline → full refund.
  if (deployed.TankerTrust) {
    for (const id of openIds(db, "TankerTrust", "OrderCreated", ["OrderSettled", "OrderExpired"])) {
      const o = await chain.read("TankerTrust", "getOrder", [BigInt(id)]);
      if ((o.status === ORDER.Open || o.status === ORDER.Delivering) && now > BigInt(o.deadline)) {
        out.push({ contract: "TankerTrust", fn: "expireOrder", args: [BigInt(id)], key: `expire:${id}` });
      }
    }
  }
  return out;
}

/** One keeper pass: find, dry-run, send (serially). Returns the tx hashes sent. */
export async function runKeeperOnce(db: Db, chain: KeeperChain, deployed: Partial<Record<ContractName, string>>): Promise<string[]> {
  const sent: string[] = [];
  for (const a of await findActions(db, chain, deployed)) {
    const jobKey = `keeper:${a.fn}:${a.key}`;
    const job = db.get<{ status: string }>("SELECT status FROM jobs WHERE key = ?", [jobKey]);
    if (job?.status === "sent") continue;
    if (!(await chain.wouldSucceed(a))) continue; // someone else already did it, or not yet valid
    try {
      const hash = await chain.send(a);
      db.run(
        `INSERT INTO jobs (key, kind, status, attempts, tx_hash, updated_at) VALUES (?, 'keeper', 'sent', 1, ?, ?)
         ON CONFLICT(key) DO UPDATE SET status = 'sent', attempts = attempts + 1, tx_hash = excluded.tx_hash, updated_at = excluded.updated_at`,
        [jobKey, hash, Date.now()],
      );
      sent.push(hash);
    } catch (err) {
      db.run(
        `INSERT INTO jobs (key, kind, status, attempts, last_error, updated_at) VALUES (?, 'keeper', 'failed', 1, ?, ?)
         ON CONFLICT(key) DO UPDATE SET status = 'failed', attempts = attempts + 1, last_error = excluded.last_error, updated_at = excluded.updated_at`,
        [jobKey, (err as Error).message.slice(0, 300), Date.now()],
      );
    }
  }
  return sent;
}

const ABI: Partial<Record<ContractName, readonly unknown[]>> = {
  RentalEscrow: rentalEscrowAbi, MilestoneEscrow: milestoneEscrowAbi, SocietyLedger: societyLedgerAbi, TankerTrust: tankerTrustAbi,
};

/** ethers-backed KeeperChain on the keeper wallet. Uses chain time, not the server clock. */
export function ethersKeeperChain(wallet: Wallet, deployed: Partial<Record<ContractName, string>>): KeeperChain {
  const contracts = new Map<ContractName, Contract>();
  const c = (name: ContractName) => {
    if (!contracts.has(name)) contracts.set(name, new Contract(deployed[name]!, ABI[name] as never, wallet));
    return contracts.get(name)!;
  };
  return {
    async now() {
      const b = await wallet.provider!.getBlock("latest");
      return BigInt(b!.timestamp);
    },
    read: (name, fn, args) => c(name)[fn](...args),
    async wouldSucceed(a) {
      try {
        await c(a.contract)[a.fn].staticCall(...a.args);
        return true;
      } catch {
        return false;
      }
    },
    async send(a) {
      const tx = await c(a.contract)[a.fn](...a.args);
      await tx.wait(1);
      console.log(`[keeper] ${a.contract}.${a.fn}(${a.args.join(",")}) https://testnet.mstscan.com/tx/${tx.hash}`);
      return tx.hash;
    },
  };
}

/** Starts the 15 s loop. Returns a stop function. */
export function startKeeper(db: Db, wallet: Wallet, chainId: number): () => void {
  const deployed = addresses[chainId] ?? {};
  const chain = ethersKeeperChain(wallet, deployed);
  let stopped = false;
  let running = false;
  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      await runKeeperOnce(db, chain, deployed);
    } catch (err) {
      console.warn("[keeper] pass failed:", (err as Error).message);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, INTERVAL_MS);
  void tick();
  console.log(`[keeper] started; wallet ${wallet.address}`);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
