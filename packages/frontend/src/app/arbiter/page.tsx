"use client";

import Link from "next/link";
import { useAccount, useReadContract } from "wagmi";
import { StatusChip } from "@/components/Badges";
import { Countdown } from "@/components/Countdown";
import { RequireDeployed, RequireWallet } from "@/components/Gates";
import { useNest } from "@/hooks/useNest";
import { bit } from "@/lib/lease";
import { DisputeStatus as DisputeStatusEnum } from "@nestledger/shared";

export default function ArbiterListPage() {
  const { contracts } = useNest();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">Disputes assigned to you</h1>
      <RequireWallet>
        <RequireDeployed address={contracts.resolver.address} name="DisputeResolver">
          <List />
        </RequireDeployed>
      </RequireWallet>
    </div>
  );
}

function List() {
  const { address } = useAccount();
  const { contracts } = useNest();
  const ids = useReadContract({
    address: contracts.resolver.address!, abi: contracts.resolver.abi, functionName: "disputesOf", args: [address!],
    query: { enabled: !!address, refetchInterval: 8000 },
  });
  const list = (ids.data as readonly bigint[] | undefined) ?? [];
  if (!ids.data) return <p className="text-sm text-slate-500">Loading…</p>;
  if (!list.length) return <p className="text-sm text-slate-600">No disputes have been assigned to this wallet.</p>;
  return <ul className="space-y-2">{[...list].reverse().map((id) => <Row key={String(id)} id={id} />)}</ul>;
}

function Row({ id }: { id: bigint }) {
  const { address } = useAccount();
  const { contracts } = useNest();
  const d = useReadContract({ address: contracts.resolver.address!, abi: contracts.resolver.abi, functionName: "getDispute", args: [id], query: { refetchInterval: 8000 } });
  if (!d.data) return <li className="text-sm text-slate-500">Dispute #{String(id)}…</li>;
  const x = d.data as unknown as { escrow: string; agreementId: bigint; arbiters: readonly string[]; votedBits: number; voteDeadline: bigint; status: number };
  const slot = x.arbiters.findIndex((a) => a.toLowerCase() === address?.toLowerCase());
  const voted = slot >= 0 && bit(x.votedBits, slot);
  const kind = x.escrow.toLowerCase() === contracts.rental.address?.toLowerCase() ? "Lease" : "Project";
  return (
    <li className="card flex flex-wrap items-center justify-between gap-2">
      <div>
        <Link href={`/arbiter/${id}`} className="font-medium text-accent underline">Dispute #{String(id)}</Link>{" "}
        <span className="text-sm text-slate-600">{kind} #{String(x.agreementId)}</span>
        <p className="text-sm text-slate-600">{voted ? "You have voted." : x.status === 0 ? "Your vote is needed." : ""}</p>
      </div>
      <div className="flex items-center gap-2">
        {x.status === 0 && <Countdown until={x.voteDeadline} />}
        <StatusChip kind="dispute" value={x.status} enumValues={DisputeStatusEnum} />
      </div>
    </li>
  );
}
