"use client";

// SPEC §8.5 — public transparency dashboard. No wallet, no sign-in: everything is read from the chain
// and from public backend data (invoices, AI reports, indexed events).
import { useQueries, useQuery } from "@tanstack/react-query";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { explorerAddress, formatINR, ProposalStatus, weiToInr, ZERO_HASH } from "@nestledger/shared";
import type { InvoiceDoc, Note } from "@nestledger/shared/schemas";
import { Amount } from "@/components/Amount";
import { StatusChip } from "@/components/Badges";
import { Countdown } from "@/components/Countdown";
import { Notice } from "@/components/Gates";
import { AddressLink, TxLink } from "@/components/TxLink";
import { useNest } from "@/hooks/useNest";
import { useSocietyData, type ProposalRow, type SocietyData } from "@/hooks/useSociety";
import { getManifest, getTimeline, publicEvidenceUrl } from "@/lib/api";
import { KIND_TEXT, paidThisMonth, ZERO_ADDR } from "@/lib/society";
import { InvoiceFlag } from "@/app/society/[id]/proposals";

export default function PublicSocietyPage({ params }: { params: { id: string } }) {
  const { contracts } = useNest();
  const q = useSocietyData(params.id);
  if (!contracts.ledger.address) {
    return <Notice>The society treasury contract is not deployed on MST Testnet yet. This page goes live with it.</Notice>;
  }
  if (q.isError) return <Notice tone="error">Society #{params.id} could not be loaded.</Notice>;
  if (!q.data) return <p className="text-sm text-slate-500">Loading the public ledger…</p>;
  if (q.data.society.admin === ZERO_ADDR) return <Notice>There is no society #{params.id}.</Notice>;
  return <Dashboard id={params.id} d={q.data} ledger={contracts.ledger.address} />;
}

function Dashboard({ id, d, ledger }: { id: string; d: SocietyData; ledger: string }) {
  const s = d.society;
  const executed = d.proposals.filter((p) => ProposalStatus[p.status] === "Executed");
  const open = d.proposals.filter((p) => p.status < 2);
  const byCategory = Object.entries(
    executed.reduce<Record<string, number>>((acc, p) => {
      const k = p.category || KIND_TEXT[p.kind];
      acc[k] = (acc[k] ?? 0) + weiToInr(p.amount);
      return acc;
    }, {}),
  ).map(([category, inr]) => ({ category, inr }));

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-slate-900">{s.name}</h1>
        <p className="text-sm text-slate-600">
          <span className="chip mr-2 bg-accent-light text-accent-dark">Verified on MST Testnet</span>
          Every rupee in and out of this treasury is a public contract transaction.{" "}
          <a className="text-accent underline" href={explorerAddress(ledger)} target="_blank" rel="noreferrer">See the contract on MSTScan ↗</a>
        </p>
        <p className="text-xs text-slate-500">No wallet needed. Refreshes every 5 seconds.</p>
      </header>

      <section className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {([["Treasury balance", s.balance], ["Available", d.available], ["Reserved for open proposals", s.committed], ["Collected (all time)", s.totalCollected], ["Spent (all time)", s.totalSpent]] as const).map(([label, wei]) => (
          <div key={label} className="card"><p className="text-xs uppercase text-slate-500">{label}</p><Amount wei={wei} /></div>
        ))}
      </section>

      {byCategory.length > 0 && (
        <section className="card space-y-2">
          <h2 className="font-semibold text-slate-900">Spending by category</h2>
          <div className="h-56 w-full">
            <ResponsiveContainer>
              <BarChart data={byCategory}>
                <XAxis dataKey="category" tick={{ fontSize: 12 }} />
                <YAxis tickFormatter={(v: number) => formatINR(v)} tick={{ fontSize: 11 }} width={80} />
                <Tooltip formatter={(v: number) => [`${formatINR(v)} (demo rate)`, "Spent"]} />
                <Bar dataKey="inr" fill="#0F766E" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      <section className="card space-y-3">
        <h2 className="font-semibold text-slate-900">Payouts</h2>
        {!executed.length && <p className="text-sm text-slate-500">No payouts yet.</p>}
        {executed.map((p) => <Payout key={String(p.id)} p={p} />)}
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold text-slate-900">Open proposals</h2>
        {!open.length && <p className="text-sm text-slate-500">Nothing is waiting for approval.</p>}
        {open.map((p) => <OpenProposal key={String(p.id)} p={p} d={d} />)}
      </section>


      <section className="card space-y-2">
        <h2 className="font-semibold text-slate-900">Maintenance this month</h2>
        <div className="flex flex-wrap gap-2">
          {d.flats.map((f) => (
            <span key={String(f.id)} className={`chip ${paidThisMonth(f) ? "bg-accent-light text-accent-dark" : "bg-slate-100 text-slate-600"}`}>
              {f.label} {paidThisMonth(f) ? "✓ paid" : "not yet"}
            </span>
          ))}
          {!d.flats.length && <p className="text-sm text-slate-500">No flats registered yet.</p>}
        </div>
      </section>
    </div>
  );
}

function useProposalEvents(p: ProposalRow) {
  return useQuery({ queryKey: ["timeline", "ledger", String(p.id)], queryFn: () => getTimeline("ledger", String(p.id)), refetchInterval: 5000, retry: false });
}

function Payout({ p }: { p: ProposalRow }) {
  const events = useProposalEvents(p);
  const doc = useQuery({
    queryKey: ["manifest", p.docHash], enabled: p.kind === 0 && p.docHash !== ZERO_HASH, retry: false, staleTime: Infinity,
    queryFn: () => getManifest<InvoiceDoc>(p.docHash),
  });
  const executedEv = events.data?.find((e) => e.name === "ProposalExecuted");
  const approvals = (events.data ?? []).filter((e) => e.name === "Approved");
  return (
    <div className="space-y-2 border-t border-slate-100 pt-3 first:border-0 first:pt-0">
      <div className="flex flex-wrap items-start justify-between gap-2 text-sm">
        <div>
          <p className="font-medium text-slate-900">
            {KIND_TEXT[p.kind]}{p.category && ` · ${p.category}`} · <Amount wei={p.amount} inline />
          </p>
          <p className="text-xs text-slate-600">
            To <AddressLink address={p.payee} />
            {executedEv && <> · paid {new Date(executedEv.timestamp * 1000).toLocaleDateString("en-IN")}</>}
          </p>
        </div>
        {executedEv && <TxLink hash={executedEv.txHash} />}
      </div>
      {doc.data && (
        <p className="text-xs">
          Invoice: {doc.data.files.map((h, i) => <a key={h} className="mr-2 text-accent underline" href={publicEvidenceUrl(h)} target="_blank" rel="noreferrer">page {i + 1}</a>)}
        </p>
      )}
      {p.kind === 0 && <InvoiceFlag p={p} />}
      {approvals.length > 0 && (
        <div className="text-xs text-slate-600">
          Approved by:{" "}
          {approvals.map((a) => <Approver key={`${a.txHash}-${a.args.member}`} member={String(a.args.member)} reasonHash={String(a.args.overrideReasonHash)} txHash={a.txHash} />)}
        </div>
      )}
    </div>
  );
}

function Approver({ member, reasonHash, txHash }: { member: string; reasonHash: string; txHash: string }) {
  const note = useQuery({
    queryKey: ["manifest", reasonHash], enabled: reasonHash !== ZERO_HASH, retry: false, staleTime: Infinity,
    queryFn: () => getManifest<Note>(reasonHash),
  });
  return (
    <span className="mr-3 inline-block">
      <AddressLink address={member} />
      {reasonHash !== ZERO_HASH && (
        <span className="ml-1 italic text-slate-700">
          {note.data ? `"${note.data.text}"` : note.isError ? "(override reason on record; sign in to read it)" : "…"}
        </span>
      )}{" "}
      <TxLink hash={txHash} />
    </span>
  );
}

function OpenProposal({ p, d }: { p: ProposalRow; d: SocietyData }) {
  const total = d.society.totalWeight;
  const quorumPct = d.society.config.quorumBps / 100;
  const voting = ProposalStatus[p.status] === "CommitteeApproved";
  return (
    <div className="space-y-2 border-t border-slate-100 pt-3 text-sm first:border-0 first:pt-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="font-medium text-slate-900">#{String(p.id)} · {KIND_TEXT[p.kind]}{p.category && ` · ${p.category}`} · <Amount wei={p.amount} inline /></p>
        <StatusChip kind="proposal" value={p.status} enumValues={ProposalStatus} />
      </div>
      <p className="text-xs text-slate-600">
        Tier {p.effectiveTier}{p.effectiveTier !== p.tier && " (raised by an AI flag)"} · committee approvals {p.approvals}/{p.required}
      </p>
      {p.kind === 0 && <InvoiceFlag p={p} />}
      {voting && (
        <div className="space-y-1">
          <p className="text-xs text-slate-600">
            Residents: {String(p.votesFor)} for · {String(p.votesAgainst)} against (weight of {total}; quorum {quorumPct}%) · closes in <Countdown until={p.voteEnds} />
          </p>
          <div className="relative h-2 w-full rounded bg-slate-100">
            <div className="absolute h-2 rounded bg-accent" style={{ width: `${total ? (Number(p.votesFor) / total) * 100 : 0}%` }} />
            <div className="absolute h-2 rounded bg-red-400" style={{ left: `${total ? (Number(p.votesFor) / total) * 100 : 0}%`, width: `${total ? (Number(p.votesAgainst) / total) * 100 : 0}%` }} />
            <div className="absolute -top-1 h-4 w-0.5 bg-slate-700" style={{ left: `${quorumPct}%` }} title="Quorum" />
          </div>
        </div>
      )}
    </div>
  );
}

