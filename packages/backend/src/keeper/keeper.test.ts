// D2 keeper: turns indexed events + chain state into the right timeout calls, dry-runs first, sends once.
import { beforeEach, describe, expect, it } from "vitest";
import type { ContractName } from "@nestledger/shared";
import { openDb, type Db } from "../db/index.js";
import { findActions, runKeeperOnce, type Action, type KeeperChain } from "./index.js";

const ALL: Partial<Record<ContractName, string>> = {
  RentalEscrow: "0x1", MilestoneEscrow: "0x2", SocietyLedger: "0x3", TankerTrust: "0x4",
};

function addEvent(db: Db, contract: string, name: string, k1: string, n: number) {
  db.run("INSERT INTO events (contract, name, block, tx_hash, log_index, ts, args_json, k1, k2) VALUES (?,?,?,?,?,?,?,?,?)",
    [contract, name, n, `0x${n}`, 0, 0, "{}", k1, null]);
}

/** Chain state keyed by "Contract.fn:args". */
function fakeChain(now: bigint, state: Record<string, any>, succeed = true): KeeperChain & { sent: Action[] } {
  const sent: Action[] = [];
  return {
    sent,
    now: async () => now,
    read: async (contract, fn, args) => {
      const key = `${contract}.${fn}:${args.map(String).join(",")}`;
      if (!(key in state)) throw new Error(`unexpected read ${key}`);
      return state[key];
    },
    wouldSucceed: async () => succeed,
    send: async (a) => {
      sent.push(a);
      return `0xtx${sent.length}`;
    },
  };
}

describe("keeper", () => {
  let db: Db;
  beforeEach(() => {
    db = openDb(":memory:");
  });

  it("presumes a baseline after its window, but not before", async () => {
    addEvent(db, "RentalEscrow", "LeaseSigned", "1", 1);
    addEvent(db, "RentalEscrow", "BaselineSubmitted", "1", 2);
    const lease = { baseline: 1n, baselineAt: 1000n, baselineWindow: 90n };
    expect(await findActions(db, fakeChain(1090n, { "RentalEscrow.getLease:1": lease }), ALL)).toEqual([]);
    expect(await findActions(db, fakeChain(1091n, { "RentalEscrow.getLease:1": lease }), ALL)).toEqual([
      { contract: "RentalEscrow", fn: "finalizeBaseline", args: [1n], key: "baseline:1" },
    ]);
  });

  it("refunds an unclaimed deposit after the claim deadline", async () => {
    addEvent(db, "RentalEscrow", "LeaseSigned", "2", 1);
    addEvent(db, "RentalEscrow", "MoveOutStarted", "2", 2);
    const chain = fakeChain(2000n, {
      "RentalEscrow.getLease:2": { baseline: 4n },
      "RentalEscrow.getTranche:2,0": { status: 1n, claimDeadline: 1999n },
    });
    expect((await findActions(db, chain, ALL)).map((a) => a.fn)).toEqual(["finalizeNoClaim"]);
  });

  it("finalises silence on rental and milestone claims once the response window passes", async () => {
    addEvent(db, "MilestoneEscrow", "ClaimSubmitted", "5", 1);
    const chain = fakeChain(500n, {
      "MilestoneEscrow.getAgreement:5": { current: 1n, responseWindow: 90n },
      "MilestoneEscrow.getTranche:5,1": { status: 2n },
      "MilestoneEscrow.getClaim:5,1": { submittedAt: 400n, round: 1n },
    });
    expect(await findActions(db, chain, ALL)).toEqual([
      { contract: "MilestoneEscrow", fn: "finalizeAfterSilence", args: [5n], key: "silence:MilestoneEscrow:5:1:1" },
    ]);
  });

  it("skips closed agreements and finished proposals / orders", async () => {
    addEvent(db, "RentalEscrow", "LeaseSigned", "3", 1);
    addEvent(db, "RentalEscrow", "ClaimSubmitted", "3", 2);
    addEvent(db, "RentalEscrow", "LeaseClosed", "3", 3);
    addEvent(db, "SocietyLedger", "ProposalCreated", "9", 4);
    addEvent(db, "SocietyLedger", "ProposalExecuted", "9", 5);
    addEvent(db, "TankerTrust", "OrderCreated", "4", 6);
    addEvent(db, "TankerTrust", "OrderSettled", "4", 7);
    expect(await findActions(db, fakeChain(10_000n, {}), ALL)).toEqual([]); // no reads at all
  });

  it("executes ready proposals and ended tier-2 votes; expires late tanker orders", async () => {
    addEvent(db, "SocietyLedger", "ProposalCreated", "1", 1);
    addEvent(db, "SocietyLedger", "ProposalCreated", "2", 2);
    addEvent(db, "SocietyLedger", "ProposalCreated", "3", 3);
    addEvent(db, "TankerTrust", "OrderCreated", "7", 4);
    const chain = fakeChain(1000n, {
      "SocietyLedger.getProposal:1": { status: 0n, voteEnds: 0n },
      "SocietyLedger.canExecute:1": [true, ""],
      "SocietyLedger.getProposal:2": { status: 1n, voteEnds: 999n },  // vote ended (maybe failed: execute rejects it)
      "SocietyLedger.canExecute:2": [false, "quorum not met"],
      "SocietyLedger.getProposal:3": { status: 0n, voteEnds: 0n },
      "SocietyLedger.canExecute:3": [false, "awaiting approvals"],
      "TankerTrust.getOrder:7": { status: 1n, deadline: 900n },
    });
    expect((await findActions(db, chain, ALL)).map((a) => `${a.fn}(${a.args})`)).toEqual([
      "execute(1)", "execute(2)", "expireOrder(7)",
    ]);
  });

  it("dry-runs before sending, sends each action once, and records it in jobs", async () => {
    addEvent(db, "RentalEscrow", "LeaseSigned", "1", 1);
    const state = { "RentalEscrow.getLease:1": { baseline: 1n, baselineAt: 0n, baselineWindow: 90n } };

    expect(await runKeeperOnce(db, fakeChain(100n, state, false), ALL)).toEqual([]); // staticCall would revert

    const chain = fakeChain(100n, state);
    expect(await runKeeperOnce(db, chain, ALL)).toEqual(["0xtx1"]);
    expect(await runKeeperOnce(db, chain, ALL)).toEqual([]); // already sent
    expect(db.get("SELECT status, tx_hash FROM jobs WHERE key = 'keeper:finalizeBaseline:baseline:1'"))
      .toEqual({ status: "sent", tx_hash: "0xtx1" });
  });

  it("ignores contracts that are not deployed", async () => {
    addEvent(db, "TankerTrust", "OrderCreated", "7", 1);
    expect(await findActions(db, fakeChain(1000n, {}), { RentalEscrow: "0x1" })).toEqual([]);
  });
});
