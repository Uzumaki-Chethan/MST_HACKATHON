"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useAccount, useReadContract } from "wagmi";
import { DisputeStatus as DisputeStatusEnum } from "@nestledger/shared";
import type { AttestationReport, MoveOutReport, Note, RentalClaim } from "@nestledger/shared/schemas";
import { Amount } from "@/components/Amount";
import { SimulatedBadge, StatusChip } from "@/components/Badges";
import { Countdown } from "@/components/Countdown";
import { BeforeAfter, useBeforeAfter, useReport } from "@/components/Evidence";
import { Notice, RequireDeployed, RequireWallet } from "@/components/Gates";
import { AddressLink } from "@/components/TxLink";
import { useNest } from "@/hooks/useNest";
import { useTx } from "@/hooks/useTx";
import { getManifest, postManifest } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { describeError } from "@/lib/labels";
import { bit, type Attestation, type Claim, type Tranche } from "@/lib/lease";
import { ClaimedMilestone, type Agreement } from "@/app/build/[id]/panels";

type Dispute = {
  escrow: `0x${string}`; agreementId: bigint; trancheIdx: number; payer: `0x${string}`; payee: `0x${string}`;
  mask: number; amounts: readonly bigint[]; arbiters: readonly `0x${string}`[]; votes: readonly number[]; votedBits: number;
  bond: bigint; bondPayer: `0x${string}`; voteDeadline: bigint; status: number; upheldMask: number;
};

export default function ArbiterDisputePage({ params }: { params: { disputeId: string } }) {
  const { contracts } = useNest();
  return (
    <RequireWallet signedIn>
      <RequireDeployed address={contracts.resolver.address} name="DisputeResolver">
        <DisputeDetail id={params.disputeId} />
      </RequireDeployed>
    </RequireWallet>
  );
}

function DisputeDetail({ id }: { id: string }) {
  const { address } = useAccount();
  const { contracts } = useNest();
  const { session } = useAuth();
  const { send, pending } = useTx();
  const res = contracts.resolver;
  const d = useReadContract({ address: res.address!, abi: res.abi, functionName: "getDispute", args: [BigInt(id)], query: { refetchInterval: 4000 } });
  const x = d.data as unknown as Dispute | undefined;
  const isRental = !!x && x.escrow.toLowerCase() === contracts.rental.address?.toLowerCase();

  const r = contracts.rental;
  const claimQ = useReadContract({ address: r.address!, abi: r.abi, functionName: "getClaim", args: [x?.agreementId ?? BigInt(0), x?.trancheIdx ?? 0], query: { enabled: isRental } });
  const attQ = useReadContract({ address: r.address!, abi: r.abi, functionName: "getAttestation", args: [x?.agreementId ?? BigInt(0), x?.trancheIdx ?? 0], query: { enabled: isRental } });
  const claim = claimQ.data as unknown as Claim | undefined;
  const att = attQ.data as unknown as Attestation | undefined;
  const manifest = useQuery({
    queryKey: ["manifest", claim?.evidenceHash],
    queryFn: () => getManifest<RentalClaim>(claim!.evidenceHash),
    enabled: !!session && !!claim, retry: false,
  });
  const moveOut = useReport<MoveOutReport>(manifest.data?.moveOutReportHash);
  const attested = !!att && att.attestedAt > BigInt(0);
  const wrapper = useReport<AttestationReport>(attested ? att!.reportHash : null);
  const photos = useBeforeAfter(moveOut.data);

  const [decision, setDecision] = useState<Record<number, "uphold" | "reject">>({});
  const [rationale, setRationale] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (d.isError) return <Notice tone="error">Dispute #{id} could not be loaded.</Notice>;
  if (!x) return <p className="text-sm text-slate-500">Loading dispute #{id}…</p>;
  if (x.escrow === "0x0000000000000000000000000000000000000000") return <Notice>There is no dispute #{id}.</Notice>;

  const items = x.amounts.map((a, i) => ({ a, i })).filter(({ i }) => bit(x.mask, i));
  const slot = x.arbiters.findIndex((a) => a.toLowerCase() === address?.toLowerCase());
  const canVote = slot >= 0 && !bit(x.votedBits, slot) && x.status === 0;
  const allDecided = items.every(({ i }) => decision[i]);
  const findings = new Map((moveOut.data?.findings ?? []).map((f) => [f.findingId, f]));

  const vote = async () => {
    setError(null);
    try {
      const upheld = items.reduce((m, { i }) => (decision[i] === "uphold" ? m | (1 << i) : m), 0);
      const note: Note = { schema: "nestledger.note.v1", createdAt: new Date().toISOString(), purpose: "rationale", text: rationale.trim(), refs: [`dispute:${id}`] };
      const { hash } = await postManifest(note);
      await send({ address: res.address!, abi: res.abi, functionName: "vote", args: [BigInt(id), upheld, hash] }, "Submit vote");
    } catch (e) {
      setError(describeError(e));
    }
  };

  const tally = (i: number) => {
    let up = 0, down = 0;
    x.arbiters.forEach((_, s) => { if (bit(x.votedBits, s)) { if (bit(x.votes[s], i)) up++; else down++; } });
    return { up, down };
  };

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold text-slate-900">Dispute #{id}</h1>
          <StatusChip kind="dispute" value={x.status} enumValues={DisputeStatusEnum} />
        </div>
        <p className="text-sm text-slate-600">
          {isRental ? <>Deposit claim on <Link className="text-accent underline" href={`/rent/${x.agreementId}`}>lease #{String(x.agreementId)}</Link></> : <>Milestone {x.trancheIdx + 1} of project #{String(x.agreementId)}</>}.{" "}
          Payer <AddressLink address={x.payer} />, payee <AddressLink address={x.payee} />.{" "}
          {x.bondPayer === "0x0000000000000000000000000000000000000000" ? "Escalated automatically because the payer stayed silent (no bond)." : <>Disputer posted a <Amount wei={x.bond} inline /> bond.</>}
        </p>
        {x.status === 0 && <p className="text-sm text-slate-600">Voting closes in <Countdown until={x.voteDeadline} />.</p>}
      </header>

      <section className="space-y-3">
        <h2 className="font-semibold text-slate-900">Disputed items</h2>
        <p className="text-sm text-slate-600">
          Uphold an item to pay the claimed amount to the payee; reject it to return it to the payer. Each item is decided by the
          first two matching votes. Normal wear and tear should never be charged.
        </p>
        {items.map(({ a, i }) => {
          const item = manifest.data?.items.find((it) => it.index === i);
          const f = item?.findingId ? findings.get(item.findingId) : undefined;
          const reason = wrapper.data?.mapping.find((m) => m.item === i)?.reason;
          const { up, down } = tally(i);
          return (
            <div key={i} className="card space-y-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-slate-800">{i === 0 ? "Unpaid rent" : item?.description ?? `Item ${i}`}</p>
                  <p className="text-sm text-slate-600">
                    Claimed <Amount wei={a} inline />
                    {attested && <> · AI supports <Amount wei={att!.supported[i] ?? BigInt(0)} inline /></>}
                  </p>
                  {reason && (
                    <p className="text-xs text-slate-500">
                      <SimulatedBadge what={moveOut.data?.model === "fixtures" ? "AI: fixture mode" : "AI agent"} /> {reason}
                    </p>
                  )}
                  {f && <p className="text-xs text-slate-500">AI finding: {f.change.replace("_", " ")}, confidence {Math.round(f.confidence * 100)}%. {f.description}</p>}
                  <p className="text-xs text-slate-500">Votes so far: {up} uphold · {down} reject</p>
                </div>
                {canVote && (
                  <div className="flex gap-2">
                    {(["uphold", "reject"] as const).map((v) => (
                      <button key={v} onClick={() => setDecision({ ...decision, [i]: v })}
                        className={decision[i] === v ? "btn-primary" : "btn-secondary"}>
                        {v === "uphold" ? "Uphold" : "Reject"}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {f && <BeforeAfter before={photos.before.get(f.vantageId)} after={photos.after.get(f.vantageId)} label={f.description} />}
            </div>
          );
        })}
        {!isRental && x.escrow.toLowerCase() === contracts.milestone.address?.toLowerCase() && (
          <MilestoneEvidence id={String(x.agreementId)} idx={x.trancheIdx} />
        )}
      </section>

      {canVote ? (
        <section className="card space-y-3">
          <label className="block text-sm">
            <span className="text-slate-700">Your reasoning (required; stored off-chain, its hash goes on-chain with your vote)</span>
            <textarea className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" rows={3} value={rationale} onChange={(e) => setRationale(e.target.value)} />
          </label>
          {error && <p className="text-sm text-red-700">{error}</p>}
          <button className="btn-primary w-full" disabled={pending || !allDecided || !rationale.trim()} onClick={vote}>
            {allDecided ? "Submit vote" : "Decide every item to vote"}
          </button>
        </section>
      ) : (
        <Notice>{slot < 0 ? "You are not an arbiter on this dispute; this is a read-only view." : x.status === 0 ? "Your vote is recorded. Waiting for the other arbiters." : "This dispute is resolved and the contract has paid out."}</Notice>
      )}
    </div>
  );
}

/** Reference vs site photos and the AI check for a disputed milestone (read-only view of the project panel). */
function MilestoneEvidence({ id, idx }: { id: string; idx: number }) {
  const { contracts } = useNest();
  const m = contracts.milestone;
  const t = useReadContract({ address: m.address!, abi: m.abi, functionName: "getTranche", args: [BigInt(id), idx] }).data as unknown as Tranche | undefined;
  const a = useReadContract({ address: m.address!, abi: m.abi, functionName: "getAgreement", args: [BigInt(id)] }).data as unknown as Agreement | undefined;
  if (!t || !a) return <p className="text-sm text-slate-500">Loading the milestone evidence…</p>;
  return <ClaimedMilestone id={id} idx={idx} t={t} a={a} role={null} />;
}
