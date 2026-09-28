"use client";

import { useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { weiToInr, formatINR } from "@nestledger/shared";
import { Amount } from "@/components/Amount";
import { StatusChip } from "@/components/Badges";
import { Notice, RequireDeployed } from "@/components/Gates";
import { AddressLink } from "@/components/TxLink";
import { useNest } from "@/hooks/useNest";
import { useSocietyData, type SocietyData } from "@/hooks/useSociety";
import { sameAddr, ZERO_ADDR } from "@/lib/society";
import { FlatsTab } from "./flats";
import { NewProposal } from "./newProposal";
import { ProposalsList } from "./proposals";

const TABS = ["Overview", "Flats", "Proposals"] as const;
type Tab = (typeof TABS)[number];

export default function SocietyPage({ params }: { params: { id: string } }) {
  const { contracts } = useNest();
  return (
    <RequireDeployed address={contracts.ledger.address} name="SocietyLedger">
      <SocietyDetail id={params.id} />
    </RequireDeployed>
  );
}

function SocietyDetail({ id }: { id: string }) {
  const { address } = useAccount();
  const q = useSocietyData(id);
  const [tab, setTab] = useState<Tab>("Overview");
  if (q.isError) return <Notice tone="error">Society #{id} could not be loaded.</Notice>;
  if (!q.data) return <p className="text-sm text-slate-500">Loading society #{id}…</p>;
  const d = q.data;
  if (d.society.admin === ZERO_ADDR) return <Notice>There is no society #{id}.</Notice>;
  const isCommittee = d.society.committee.some((c) => sameAddr(c, address));

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{d.society.name}</h1>
          <p className="text-sm text-slate-600">
            Society #{id}{sameAddr(d.society.admin, address) && " · you are the admin"}{isCommittee && " · you are on the committee"}
          </p>
        </div>
        <Link href={`/public/society/${id}`} className="btn-secondary">Public transparency page</Link>
      </header>

      <nav className="flex flex-wrap gap-2 border-b border-slate-200">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === t ? "border-accent font-medium text-accent" : "border-transparent text-slate-600"}`}>
            {t}{t === "Proposals" && ` (${d.proposals.filter((p) => p.status < 2).length} open)`}
          </button>
        ))}
      </nav>

      {tab === "Overview" && <Overview d={d} />}
      {tab === "Flats" && <FlatsTab id={id} data={d} />}
      {tab === "Proposals" && (
        <div className="space-y-4">
          {isCommittee ? <NewProposal id={id} data={d} /> : <p className="text-sm text-slate-500">Only committee members can propose payments. Residents vote on large ones.</p>}
          <ProposalsList data={d} isCommittee={isCommittee} />
        </div>
      )}
    </div>
  );
}

function Overview({ d }: { d: SocietyData }) {
  const s = d.society;
  const tiles: [string, bigint][] = [
    ["Treasury balance", s.balance], ["Available", d.available], ["Reserved for proposals", s.committed],
    ["Collected so far", s.totalCollected], ["Spent so far", s.totalSpent],
  ];
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {tiles.map(([label, wei]) => (
          <div key={label} className="card"><p className="text-xs uppercase text-slate-500">{label}</p><Amount wei={wei} /></div>
        ))}
      </div>
      <div className="card space-y-2 text-sm">
        <h2 className="font-semibold text-slate-900">Rules</h2>
        <p>Up to {formatINR(weiToInr(s.config.tier1Limit))} per vendor this month: 1 committee approval.</p>
        <p>Up to {formatINR(weiToInr(s.config.tier2Limit))}, or any AI-flagged bill: {s.config.threshold} of {s.committee.length} committee approvals.</p>
        <p>Above that: {s.config.threshold} approvals, then a resident vote weighted per flat (quorum {s.config.quorumBps / 100}% of {s.totalWeight} weight, more for than against).</p>
        <p className="text-xs text-slate-500">A bill can be paid once the AI has checked it, or after {s.config.attestTimeout} s without a check, so an AI outage never freezes the society.</p>
      </div>
      <div className="card space-y-1 text-sm">
        <h2 className="font-semibold text-slate-900">Committee</h2>
        {s.committee.map((c) => <p key={c}><AddressLink address={c} />{sameAddr(c, s.admin) && <span className="ml-2 text-xs text-slate-500">admin</span>}</p>)}
      </div>
    </div>
  );
}

