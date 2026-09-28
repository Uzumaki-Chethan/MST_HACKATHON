// Plain-language labels (SPEC §8.6 rule 1: never show raw enums).
import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from "viem";
import { ApiError } from "./api";

export type Tone = "neutral" | "waiting" | "good" | "bad" | "info";

export const STATUS_LABELS = {
  lease: {
    Offered: ["Offer sent, awaiting tenant signature", "waiting"],
    Active: ["Active lease", "good"],
    MovingOut: ["Moving out", "info"],
    Closed: ["Closed", "neutral"],
    Cancelled: ["Offer cancelled", "neutral"],
  },
  baseline: {
    None: ["Move-in not documented yet", "waiting"],
    Submitted: ["Move-in report awaiting confirmation", "waiting"],
    Agreed: ["Move-in report agreed", "good"],
    Contested: ["Move-in report contested", "bad"],
    PresumedAccepted: ["Move-in report accepted by silence", "good"],
  },
  // Generic tranche labels; rental/project pages can pass their own wording.
  tranche: {
    Pending: ["Not started", "neutral"],
    Open: ["Open for a claim", "info"],
    Claimed: ["Awaiting payer's response", "waiting"],
    Disputed: ["With arbiters", "bad"],
    Settled: ["Paid out", "good"],
    Refunded: ["Refunded", "neutral"],
  },
  rentalTranche: {
    Pending: ["Deposit locked", "neutral"],
    Open: ["Awaiting landlord's claim", "waiting"],
    Claimed: ["Awaiting tenant response", "waiting"],
    Disputed: ["With arbiters", "bad"],
    Settled: ["Deposit settled", "good"],
    Refunded: ["Deposit refunded in full", "good"],
  },
  project: {
    AwaitingAcceptance: ["Awaiting contractor acceptance", "waiting"],
    Active: ["In progress", "good"],
    Completed: ["Completed", "good"],
    Cancelled: ["Cancelled", "neutral"],
  },
  dispute: {
    Open: ["Arbiters voting", "waiting"],
    Resolved: ["Resolved", "good"],
  },
  proposal: {
    Pending: ["Awaiting committee approvals", "waiting"],
    CommitteeApproved: ["Residents voting", "waiting"],
    Executed: ["Paid", "good"],
    Rejected: ["Rejected", "bad"],
    Cancelled: ["Cancelled", "neutral"],
  },
} as const satisfies Record<string, Record<string, readonly [string, Tone]>>;

export type StatusKind = keyof typeof STATUS_LABELS;

export function statusLabel(kind: StatusKind, value: string | number, enumValues?: readonly string[]): [string, Tone] {
  const name = typeof value === "number" && enumValues ? enumValues[value] : String(value);
  const table = STATUS_LABELS[kind] as Record<string, readonly [string, Tone]>;
  const hit = table[name];
  return hit ? [hit[0], hit[1]] : [name ?? "Unknown", "neutral"];
}

const CONTRACT_ERRORS: Record<string, string> = {
  NotParty: "Only a party to this agreement can do that.",
  BadStatus: "That action isn't available right now. The agreement may have moved on; refresh and check.",
  WindowClosed: "The time window for this action has closed.",
  WindowOpen: "It's too early. This action unlocks when the current window ends.",
  BadAmount: "The amount doesn't match what the contract expects.",
  BadInput: "Some of the details are invalid. Check the form and try again.",
  NotAuthorized: "Your wallet isn't allowed to do that.",
  EnforcedPause: "New agreements are paused right now. Existing ones keep working.",
};

/** Turns wallet, contract and API errors into one plain sentence. */
export function describeError(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof BaseError) {
    if (err.walk((e) => e instanceof UserRejectedRequestError)) return "You rejected the request in BridgeKey.";
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName;
      if (name && CONTRACT_ERRORS[name]) return CONTRACT_ERRORS[name];
      if (name) return `The contract refused this (${name}).`;
    }
    return err.shortMessage;
  }
  if ((err as { code?: number })?.code === 4001) return "You rejected the request in BridgeKey.";
  return err instanceof Error ? err.message : "Something went wrong.";
}
