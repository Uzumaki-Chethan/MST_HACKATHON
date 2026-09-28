// Who must act next on a lease, by when, and what happens if they don't (SPEC §8.6 rule 3).
import { BaselineStatus, LeaseStatus } from "@nestledger/shared";

export type LeaseView = {
  landlord: `0x${string}`;
  tenant: `0x${string}`;
  status: number;
  baseline: number;
  baselineBy: `0x${string}`;
  startedAt: bigint;
  baselineAt: bigint;
  baselineWindow: number;
  period: number;
  periods: number;
  paidPeriods: number;
};

export type NextStep = { who: "tenant" | "landlord" | "anyone" | "nobody"; text: string; deadline?: number; ifNot?: string };

const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

export function roleOf(lease: Pick<LeaseView, "landlord" | "tenant">, viewer?: string): "tenant" | "landlord" | null {
  if (same(viewer, lease.tenant)) return "tenant";
  if (same(viewer, lease.landlord)) return "landlord";
  return null;
}

export type DepositState = { status: number; claimDeadline: number; respondBy?: number };

export function nextStep(l: LeaseView, now: number, deposit?: DepositState): NextStep {
  const status = LeaseStatus[l.status];
  const baseline = BaselineStatus[l.baseline];
  const started = Number(l.startedAt);
  if (status === "Offered") return { who: "tenant", text: "Review the terms and sign; the deposit is locked in the contract." };
  if (status === "Cancelled") return { who: "nobody", text: "The offer was cancelled." };
  if (status === "Closed") return { who: "nobody", text: "The lease is closed and the deposit is settled." };
  if (status === "MovingOut") {
    const t = deposit ? ["Pending", "Open", "Claimed", "Disputed", "Settled", "Refunded"][deposit.status] : "Open";
    if (t === "Claimed") {
      return { who: "tenant", text: "Accept the landlord's claim or dispute specific items.", deadline: deposit?.respondBy, ifNot: "AI-backed items are paid and the rest go to arbiters" };
    }
    if (t === "Disputed") return { who: "nobody", text: "Three arbiters are voting on the disputed items. Everything else is already paid out." };
    return { who: "landlord", text: "Claim deductions or release the deposit in full.", deadline: deposit?.claimDeadline, ifNot: "the full deposit is refunded to the tenant" };
  }
  // Active
  if (baseline === "None") {
    const tenantDeadline = started + l.baselineWindow;
    if (now <= tenantDeadline) {
      return { who: "tenant", text: "Document the flat's move-in condition.", deadline: tenantDeadline, ifNot: "the landlord may document it instead" };
    }
    return { who: "anyone", text: "Either party can document the move-in condition now. Whoever documents first sets the baseline." };
  }
  if (baseline === "Submitted") {
    const deadline = Number(l.baselineAt) + l.baselineWindow;
    const counter = l.baselineBy.toLowerCase() === l.tenant.toLowerCase() ? "landlord" : "tenant";
    if (now <= deadline) {
      return { who: counter, text: "Confirm or contest the move-in report.", deadline, ifNot: "the report is accepted as submitted" };
    }
    return { who: "anyone", text: "The confirmation window has passed. Anyone can finalise the report as accepted." };
  }
  if (l.paidPeriods < l.periods) {
    const due = started + l.paidPeriods * l.period;
    return { who: "tenant", text: `Pay rent for period ${l.paidPeriods + 1} of ${l.periods}.`, deadline: due, ifNot: "the payment is recorded as late" };
  }
  return { who: "anyone", text: "All rent is paid. Either party can start move-out." };
}

/** RentalEscrow.getLease as viem decodes it. */
export type Lease = LeaseView & {
  flatId: bigint; societyId: bigint; rent: bigint; maintenance: bigint; deposit: bigint;
  latePeriods: number; grace: number; claimWindow: number; baselineEvidence: `0x${string}`; baselineReport: `0x${string}`;
  counterEvidence: `0x${string}`; moveOutEvidence: `0x${string}`; unpaidDues: bigint; termsHash: `0x${string}`;
};

export type Tranche = {
  amount: bigint; advance: bigint; released: bigint; refunded: bigint; itemCaps: readonly bigint[];
  duration: number; openedAt: bigint; claimDeadline: bigint; round: number; status: number; specHash: `0x${string}`;
};

export type Claim = {
  items: readonly bigint[]; evidenceHash: `0x${string}`; submittedAt: bigint; round: number;
  disputedMask: number; awardedMask: number; disputeId: bigint; late: boolean;
};

export type Attestation = { reportHash: `0x${string}`; supported: readonly bigint[]; score: number; attestedAt: bigint; attestor: `0x${string}` };

export const bit = (mask: number, i: number) => (mask & (1 << i)) !== 0;
