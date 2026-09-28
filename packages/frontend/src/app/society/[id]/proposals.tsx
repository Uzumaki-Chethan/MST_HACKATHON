"use client";

import { useState } from "react";
import Link from "next/link";
import { useAccount, useReadContract } from "wagmi";
import { ProposalStatus, ZERO_HASH } from "@nestledger/shared";
import type { InvoiceReport, Note } from "@nestledger/shared/schemas";
import { Amount } from "@/components/Amount";
import { SimulatedBadge, StatusChip } from "@/components/Badges";
import { Countdown } from "@/components/Countdown";
import { useReport } from "@/components/Evidence";
import { AddressLink } from "@/components/TxLink";
import type { FlatRow, ProposalRow, SocietyData } from "@/hooks/useSociety";
import { useNest } from "@/hooks/useNest";
import { useTx } from "@/hooks/useTx";
import { postManifest } from "@/lib/api";
import { describeError } from "@/lib/labels";
import { KIND_TEXT, sameAddr, votesFor } from "@/lib/society";

const now = () => Math.floor(Date.now() / 1000);

export function ProposalsList({ data, isCommittee }: { data: SocietyData; isCommittee: boolean }) {
  if (!data.proposals.length) return <p className="text-sm text-slate-500">No proposals yet.</p>;
  return <div className="space-y-3">{data.proposals.map((p) => <ProposalCard key={String(p.id)} p={p} data={data} isCommittee={isCommittee} />)}</div>;
}

/** The AI's invoice report is public by design (society spending). */
export function InvoiceFlag({ p }: { p: ProposalRow }) {
  const report = useReport<InvoiceReport>(p.attested && p.reportHash !== ZERO_HASH ? p.reportHash : null);
  if (!p.attested) return <span className="text-xs text-slate-500">Waiting for the AI invoice check…</span>;
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`chip ${p.flagged ? "bg-red-100 text-red-800" : "bg-accent-light text-accent-dark"}`}>
          {p.flagged ? `AI flag · risk ${p.riskScore}` : `AI check passed · risk ${p.riskScore}`}
        </span>
        {report.data && <SimulatedBadge what={report.data.model === "fixtures" ? "AI: fixture mode" : "AI agent"} />}
      </div>
      {report.data && <p className="text-xs text-slate-600">{report.data.justification}</p>}
    </div>
  );
}

function ProposalCard({ p, data, isCommittee }: { p: ProposalRow; data: SocietyData; isCommittee: boolean }) {
  const { address } = useAccount();
  const { contracts } = useNest();
  const { send, pending } = useTx();
  const ledger = contracts.ledger;
  const approved = useReadContract({
    address: ledger.address!, abi: ledger.abi, functionName: "hasApproved", args: [p.id, address!],
    query: { enabled: !!address && isCommittee, refetchInterval: 5000 },
  });
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const status = ProposalStatus[p.status];
  const open = status === "Pending" || status === "CommitteeApproved";
  const voting = status === "CommitteeApproved" && now() < Number(p.voteEnds);
  const voteOver = status === "CommitteeApproved" && now() >= Number(p.voteEnds);
  const myFlats = data.flats.filter((f) => votesFor(f, address));
  const totalWeight = data.society.totalWeight;
  const cast = Number(p.votesFor + p.votesAgainst);
  const quorumPct = data.society.config.quorumBps / 100;
  const call = (functionName: string, args: readonly unknown[], label: string) =>
    send({ address: ledger.address!, abi: ledger.abi, functionName, args }, label).catch(() => undefined);

  const approve = async () => {
    setError(null);
    try {
      let hash: `0x${string}` = ZERO_HASH;
      if (p.flagged) {
        const note: Note = { schema: "nestledger.note.v1", createdAt: new Date().toISOString(), purpose: "override", text: reason.trim(), refs: [`proposal:${p.id}`] };
        hash = (await postManifest(note)).hash;
      }
      await send({ address: ledger.address!, abi: ledger.abi, functionName: "approve", args: [p.id, hash] }, p.flagged ? "Approve with override reason" : "Approve");
    } catch (e) {
      setError(describeError(e));
    }
  };

  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium text-slate-900">#{String(p.id)} · {KIND_TEXT[p.kind]}{p.category && <span className="text-slate-500"> · {p.category}</span>}</p>
          <p className="text-sm text-slate-600">To <AddressLink address={p.payee} /> · <Amount wei={p.amount} inline /></p>
          {p.kind === 1 && status === "Executed" && <Link className="text-sm text-accent underline" href={`/build/${p.resultRef}`}>Works project #{String(p.resultRef)}</Link>}
        </div>
        <div className="flex flex-col items-end gap-1">
          <StatusChip kind="proposal" value={p.status} enumValues={ProposalStatus} />
          <span className="text-xs text-slate-500">
            Tier {p.effectiveTier}{p.effectiveTier !== p.tier && ` (raised from ${p.tier} by the AI flag)`} · approvals {p.approvals}/{p.required}
          </span>
        </div>
      </div>

      {p.kind === 0 && <InvoiceFlag p={p} />}

      {status === "CommitteeApproved" && (
        <div className="space-y-1">
          <p className="text-xs text-slate-600">
            Resident vote: {String(p.votesFor)} for · {String(p.votesAgainst)} against · {cast}/{totalWeight} weight voted (quorum {quorumPct}%)
            {voting && <> · <Countdown until={p.voteEnds} prefix="closes in ">voting closed</Countdown></>}
          </p>
          <div className="relative h-2 w-full rounded bg-slate-100">
            <div className="absolute h-2 rounded bg-accent" style={{ width: `${totalWeight ? (Number(p.votesFor) / totalWeight) * 100 : 0}%` }} />
            <div className="absolute h-2 rounded bg-red-400" style={{ left: `${totalWeight ? (Number(p.votesFor) / totalWeight) * 100 : 0}%`, width: `${totalWeight ? (Number(p.votesAgainst) / totalWeight) * 100 : 0}%` }} />
            <div className="absolute -top-1 h-4 w-0.5 bg-slate-700" style={{ left: `${quorumPct}%` }} title="Quorum" />
          </div>
        </div>
      )}

      {open && (
        <div className="space-y-2 border-t border-slate-100 pt-2">
          {isCommittee && status === "Pending" && !approved.data && (
            <div className="space-y-2">
              {p.flagged && (
                <textarea className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" rows={2}
                  placeholder="The AI flagged this bill. Explain why you approve it anyway (published with your approval)."
                  value={reason} onChange={(e) => setReason(e.target.value)} />
              )}
              <button className="btn-primary" disabled={pending || (p.flagged && !reason.trim())} onClick={approve}>
                {p.flagged ? "Approve with override reason" : "Approve"}
              </button>
            </div>
          )}
          {isCommittee && approved.data && status === "Pending" && <p className="text-xs text-slate-500">You have approved this.</p>}
          {voting && myFlats.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {myFlats.map((f) => <VoteButtons key={String(f.id)} p={p} f={f} />)}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {p.canExecute && <button className="btn-primary" disabled={pending} onClick={() => call("execute", [p.id], "Execute payment")}>Execute</button>}
            {voteOver && !p.canExecute && <button className="btn-secondary" disabled={pending} onClick={() => call("execute", [p.id], "Close the vote")}>Close the vote (quorum or majority not reached)</button>}
            {!p.canExecute && !voteOver && p.reason && <span className="text-xs text-slate-500">Not executable yet: {p.reason}</span>}
            {sameAddr(p.proposer, address) && <button className="text-xs text-red-700 underline" disabled={pending} onClick={() => call("cancel", [p.id], "Cancel proposal")}>Cancel</button>}
          </div>
          {p.canExecute && <p className="text-xs text-slate-500">The keeper executes ready proposals automatically; the button just does it now.</p>}
          {error && <p className="text-sm text-red-700">{error}</p>}
        </div>
      )}
    </div>
  );
}

function VoteButtons({ p, f }: { p: ProposalRow; f: FlatRow }) {
  const { contracts } = useNest();
  const { send, pending } = useTx();
  const ledger = contracts.ledger;
  const voted = useReadContract({ address: ledger.address!, abi: ledger.abi, functionName: "hasVoted", args: [p.id, f.id], query: { refetchInterval: 5000 } });
  if (voted.data) return <span className="text-xs text-slate-500">{f.label}: voted</span>;
  const vote = (support: boolean) =>
    send({ address: ledger.address!, abi: ledger.abi, functionName: "castVote", args: [p.id, f.id, support] }, `${f.label} votes ${support ? "for" : "against"}`).catch(() => undefined);
  return (
    <span className="flex items-center gap-1 text-xs">
      {f.label} (weight {f.weight}):
      <button className="btn-secondary px-2 py-1 text-xs" disabled={pending} onClick={() => vote(true)}>For</button>
      <button className="btn-secondary px-2 py-1 text-xs" disabled={pending} onClick={() => vote(false)}>Against</button>
    </span>
  );
}
