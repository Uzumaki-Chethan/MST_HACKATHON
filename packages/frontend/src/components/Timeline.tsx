"use client";

import { useQuery } from "@tanstack/react-query";
import { getTimeline, type TimelineContract } from "@/lib/api";
import { TxLink } from "./TxLink";

// Wording shared by every escrow (AttestedEscrow events), then per-contract wording on top.
const COMMON_LABELS: Record<string, string> = {
  AgreementCreated: "Escrow created",
  Attested: "AI agent attested the claim",
  SilenceFinalized: "Finalised after silence",
  DisputeEscalated: "Sent to arbiters",
  TrancheSettled: "Settled",
  TrancheRefunded: "Refunded",
  PayoutDeferred: "Payout held for withdrawal",
  Withdrawn: "Withdrawn",
};

const EVENT_LABELS: Partial<Record<TimelineContract, Record<string, string>>> = {
  rental: {
    LeaseOffered: "Lease offered",
    LeaseOfferCancelled: "Offer cancelled",
    LeaseSigned: "Signed; deposit locked in the contract",
    BaselineSubmitted: "Move-in report submitted",
    BaselineConfirmed: "Move-in report confirmed",
    BaselineContested: "Move-in report contested",
    BaselinePresumed: "Move-in report accepted by silence",
    RentPaid: "Rent paid (rent to landlord, maintenance to society)",
    MoveOutStarted: "Move-out started",
    TrancheOpened: "Deposit claim window opened",
    ClaimSubmitted: "Deductions claimed",
    Responded: "Tenant responded",
    ItemsAwarded: "Items paid out",
    DepositReleasedInFull: "Deposit released in full",
    LeaseClosed: "Lease closed",
  },
  milestone: {
    MilestoneDefined: "Milestone defined",
    ProjectCreated: "Project created and funded",
    ProjectAccepted: "Contractor accepted the project",
    TrancheOpened: "Milestone opened; materials advance paid",
    ClaimSubmitted: "Contractor claimed the milestone",
    Responded: "Homeowner responded",
    ReworkRequested: "Rework requested",
    ItemsAwarded: "Milestone payment released",
    ChangeOrderProposed: "Change order proposed",
    ChangeOrderApproved: "Change order approved",
    ChangeOrderRejected: "Change order rejected",
    ProjectCompleted: "Project completed",
    ProjectCancelled: "Project cancelled",
  },
};


/** Event history from the backend indexer, each with its MSTScan link (SPEC §8.6 rule 2). */
export function Timeline({ contract, id }: { contract: TimelineContract; id: string }) {
  const q = useQuery({ queryKey: ["timeline", contract, id], queryFn: () => getTimeline(contract, id), refetchInterval: 4000 });
  if (q.isError) return <p className="text-sm text-slate-500">History isn&apos;t available yet (the indexer isn&apos;t reachable).</p>;
  if (!q.data) return <p className="text-sm text-slate-500">Loading history…</p>;
  if (!q.data.length) return <p className="text-sm text-slate-500">No on-chain events yet.</p>;
  return (
    <ol className="space-y-2">
      {q.data.map((e, i) => (
        <li key={`${e.txHash}-${e.name}-${i}`} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2 text-sm">
          <span>
            <span className="text-slate-800">{EVENT_LABELS[contract]?.[e.name] ?? COMMON_LABELS[e.name] ?? e.name}</span>{" "}
            <span className="text-xs text-slate-500">{new Date(e.timestamp * 1000).toLocaleString("en-IN")}</span>
          </span>
          <TxLink hash={e.txHash} />
        </li>
      ))}
    </ol>
  );
}
