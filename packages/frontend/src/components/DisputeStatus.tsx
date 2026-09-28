"use client";

import Link from "next/link";
import { useReadContract } from "wagmi";
import { Amount } from "@/components/Amount";
import { Countdown } from "@/components/Countdown";
import { Notice } from "@/components/Gates";
import { AddressLink } from "@/components/TxLink";
import { useNest } from "@/hooks/useNest";
import { bit } from "@/lib/lease";

type Dispute = {
  mask: number; arbiters: readonly `0x${string}`[]; votes: readonly number[]; votedBits: number;
  voteDeadline: bigint; status: number; amounts: readonly bigint[];
};

/** Live arbiter votes for the dispute on one tranche of any AttestedEscrow (rental or milestone). */
export function DisputeStatus({ escrow, agreementId, idx = 0 }: { escrow?: `0x${string}`; agreementId: string; idx?: number }) {
  const { contracts } = useNest();
  const res = contracts.resolver;
  const disputeId = useReadContract({
    address: res.address!, abi: res.abi, functionName: "disputeFor", args: [escrow!, BigInt(agreementId), idx],
    query: { enabled: !!res.address && !!escrow, refetchInterval: 4000 },
  });
  const d = useReadContract({
    address: res.address!, abi: res.abi, functionName: "getDispute", args: [disputeId.data as bigint],
    query: { enabled: !!disputeId.data, refetchInterval: 4000 },
  });
  if (!res.address) return <Notice>The DisputeResolver is not deployed yet.</Notice>;
  if (!d.data) return <p className="text-sm text-slate-500">Loading the dispute…</p>;
  const dispute = d.data as unknown as Dispute;
  const items = dispute.amounts.map((a, i) => ({ a, i })).filter(({ i }) => bit(dispute.mask, i));
  return (
    <section className="card space-y-3">
      <h2 className="font-semibold text-slate-900">
        With the arbiters (<Link className="text-accent underline" href={`/arbiter/${String(disputeId.data)}`}>dispute #{String(disputeId.data)}</Link>)
      </h2>
      <p className="text-sm text-slate-600">
        Three neutral arbiters vote on each disputed item. An item is decided as soon as two agree, and the contract pays out automatically.
      </p>
      <ul className="space-y-1 text-sm">
        {items.map(({ a, i }) => {
          let up = 0, down = 0;
          dispute.arbiters.forEach((_, s) => { if (bit(dispute.votedBits, s)) { if (bit(dispute.votes[s], i)) up++; else down++; } });
          return <li key={i}>Item {i} (<Amount wei={a} inline />): {up} uphold · {down} reject</li>;
        })}
      </ul>
      <p className="text-xs text-slate-500">
        Arbiters: {dispute.arbiters.map((x, s) => <span key={x} className="mr-2"><AddressLink address={x} />{bit(dispute.votedBits, s) ? " ✓" : ""}</span>)}
      </p>
      {dispute.status === 0 && <p className="text-xs text-slate-500"><Countdown until={dispute.voteDeadline} prefix="Voting closes in ">The voting window has passed; votes still count</Countdown> (after that the admin can replace a silent arbiter).</p>}
    </section>
  );
}
