"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { isAddress } from "viem";
import { useReadContract } from "wagmi";
import { Kind, Stat, type KindName } from "@nestledger/shared";
import { Notice, RequireDeployed } from "@/components/Gates";
import { AddressLink, TxLink } from "@/components/TxLink";
import { useNest } from "@/hooks/useNest";
import { getPublicPassport } from "@/lib/api";

const TIERS = [
  { name: "Tier 0", text: "Not verified yet", tone: "bg-slate-100 text-slate-700" },
  { name: "Tier 1", text: "Verified", tone: "bg-sky-100 text-sky-800" },
  { name: "Tier 2", text: "Reliable renter: pays 75% of the usual deposit", tone: "bg-accent-light text-accent-dark" },
  { name: "Tier 3", text: "Trusted renter: pays 50% of the usual deposit", tone: "bg-accent text-white" },
];

type StatName = (typeof Stat)[number];
const GROUPS: { title: string; stats: [StatName, string][] }[] = [
  { title: "As a tenant", stats: [["RentOnTime", "Rent paid on time"], ["RentLate", "Rent paid late"], ["LeasesCompleted", "Leases completed"], ["DepositFullRefunds", "Deposits fully refunded"]] },
  { title: "As a landlord", stats: [["DepositsReturned", "Deposits returned without dispute"], ["DeductionsUpheld", "Deductions upheld by arbiters"], ["DeductionsRejected", "Deductions rejected by arbiters"]] },
  { title: "As a contractor", stats: [["MilestonesApproved", "Milestones approved"], ["MilestonesOnTime", "On time"], ["MilestonesLate", "Late"], ["ProjectsCompleted", "Projects completed"], ["ProjectsAbandoned", "Projects abandoned"]] },
  { title: "As a payer", stats: [["PromptDecisions", "Decided within the window"], ["SilentDecisions", "Let the window lapse"]] },
  { title: "Disputes", stats: [["DisputesWon", "Won"], ["DisputesLost", "Lost"]] },
  { title: "As a vendor", stats: [["InvoicesPaid", "Invoices paid"], ["InvoicesFlagged", "Invoices flagged by the AI"]] },
  { title: "As a committee member", stats: [["CommitteeVotes", "Approvals given"], ["FlagOverrides", "AI flags overridden (with a written reason)"]] },
];

export default function PassportPage({ params }: { params: { address: string } }) {
  const { contracts } = useNest();
  if (!isAddress(params.address)) return <Notice tone="error">That is not a wallet address.</Notice>;
  return (
    <RequireDeployed address={contracts.passport.address} name="NestPassport">
      <Passport address={params.address} />
    </RequireDeployed>
  );
}

function Passport({ address }: { address: `0x${string}` }) {
  const { contracts } = useNest();
  const p = contracts.passport;
  const [url, setUrl] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => setUrl(window.location.href), []);

  // Numbers come straight from the chain; the backend adds profile details and recent activity.
  const has = useReadContract({ address: p.address!, abi: p.abi, functionName: "hasPassport", args: [address] });
  const tier = useReadContract({ address: p.address!, abi: p.abi, functionName: "tenantTier", args: [address], query: { refetchInterval: 8000 } });
  const score = useReadContract({ address: p.address!, abi: p.abi, functionName: "trustScore", args: [address], query: { refetchInterval: 8000 } });
  const stats = useReadContract({ address: p.address!, abi: p.abi, functionName: "statsOf", args: [address], query: { refetchInterval: 8000 } });
  const pub = useQuery({ queryKey: ["publicPassport", address], queryFn: () => getPublicPassport(address), retry: false, refetchInterval: 8000 });

  if (has.data === false) return <Notice>This wallet has no NestPassport yet. It gets one when it creates a NestLedger profile.</Notice>;
  if (tier.data === undefined || score.data === undefined || !stats.data) return <p className="text-sm text-slate-500">Loading passport…</p>;

  const t = TIERS[Number(tier.data)] ?? TIERS[0];
  const value = (s: StatName) => Number((stats.data as readonly number[])[Stat.indexOf(s)] ?? 0);
  const kinds = pub.data ? (Object.keys(Kind) as KindName[]).filter((k) => pub.data!.kinds & Kind[k]) : [];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">NestPassport</h1>
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <AddressLink address={address} />
            <button className="text-xs text-accent underline" onClick={() => { navigator.clipboard?.writeText(address); setCopied(true); }}>
              {copied ? "Copied" : "Copy address"}
            </button>
            {pub.data?.verified && <span className="chip bg-accent-light text-accent-dark">Verified</span>}
          </p>
          <p className="text-xs text-slate-500">Soulbound: cannot be transferred or sold. Every number below is recorded by the NestLedger contracts on MST Testnet.</p>
          {kinds.length > 0 && <p className="text-sm capitalize text-slate-600">Roles: {kinds.map((k) => k.toLowerCase()).join(", ")}</p>}
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <span className={`chip px-3 py-1 text-sm ${t.tone}`}>{t.name}</span>
            <span className="text-sm text-slate-700">{t.text}</span>
          </div>
          <p className="text-3xl font-bold text-slate-900">
            {String(score.data)} <span className="text-base font-normal text-slate-500">/ 1000 trust score</span>
          </p>
        </div>
        {url && (
          <div className="rounded-md border border-slate-200 p-3 text-center">
            <QRCodeSVG value={url} size={128} />
            <p className="mt-1 text-xs text-slate-500">Scan to open this passport</p>
          </div>
        )}
      </header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {GROUPS.map((g) => {
          const rows = g.stats.map(([s, label]) => [label, value(s)] as const);
          const total = rows.reduce((a, [, v]) => a + v, 0);
          return (
            <div key={g.title} className={`card space-y-2 ${total === 0 ? "opacity-60" : ""}`}>
              <h2 className="text-sm font-semibold text-slate-900">{g.title}</h2>
              <dl className="space-y-1 text-sm">
                {rows.map(([label, v]) => (
                  <div key={label} className="flex justify-between gap-2"><dt className="text-slate-600">{label}</dt><dd className="font-medium tabular-nums">{v}</dd></div>
                ))}
              </dl>
            </div>
          );
        })}
      </section>

      <section className="card space-y-2">
        <h2 className="font-semibold text-slate-900">Recent activity</h2>
        {pub.isError && <p className="text-sm text-slate-500">Activity history isn&apos;t available right now; the numbers above are read from the chain.</p>}
        {pub.data && !pub.data.recent.length && <p className="text-sm text-slate-500">No activity yet.</p>}
        <ul className="space-y-1">
          {pub.data?.recent.filter((e) => e.name !== "Transfer").map((e) => (
            <li key={`${e.txHash}-${e.name}`} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>{e.name.replace(/([a-z])([A-Z])/g, "$1 $2")} <span className="text-xs text-slate-500">({e.contract}) {new Date(e.timestamp * 1000).toLocaleString("en-IN")}</span></span>
              <TxLink hash={e.txHash} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
