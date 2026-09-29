"use client";

import { useAccount, useReadContract } from "wagmi";
import { ProjectStatus, TrancheStatus } from "@nestledger/shared";
import { Amount } from "@/components/Amount";
import { StatusChip } from "@/components/Badges";
import { DisputeStatus } from "@/components/DisputeStatus";
import { Notice, RequireDeployed, SignInHint } from "@/components/Gates";
import { Timeline } from "@/components/Timeline";
import { AddressLink } from "@/components/TxLink";
import { useNest } from "@/hooks/useNest";
import type { Tranche } from "@/lib/lease";
import { AwaitingAcceptance, ClaimedMilestone, OpenMilestone, type Agreement, type Role } from "./panels";

type Project = { status: number; specHash: `0x${string}`; reworkWindow: number; flatId: bigint; acceptedAt: bigint; changeOrderCount: number };

export default function ProjectPage({ params }: { params: { id: string } }) {
  const { contracts } = useNest();
  return (
    <RequireDeployed address={contracts.milestone.address} name="MilestoneEscrow">
      <ProjectDetail id={params.id} />
    </RequireDeployed>
  );
}

function ProjectDetail({ id }: { id: string }) {
  const { address } = useAccount();
  const { contracts } = useNest();
  const m = contracts.milestone;
  const q = { refetchInterval: 4000 };
  const project = useReadContract({ address: m.address!, abi: m.abi, functionName: "getProject", args: [BigInt(id)], query: q });
  const agreement = useReadContract({ address: m.address!, abi: m.abi, functionName: "getAgreement", args: [BigInt(id)], query: q });
  const a = agreement.data as unknown as Agreement | undefined;
  const current = useReadContract({
    address: m.address!, abi: m.abi, functionName: "getTranche", args: [BigInt(id), a?.current ?? 0], query: { ...q, enabled: !!a },
  });

  if (project.isError || agreement.isError) return <Notice tone="error">Project #{id} could not be loaded.</Notice>;
  const p = project.data as unknown as Project | undefined;
  if (!p || !a) return <p className="text-sm text-slate-500">Loading project #{id}…</p>;
  if (a.payer === "0x0000000000000000000000000000000000000000") return <Notice>There is no project #{id}.</Notice>;

  const role: Role = address?.toLowerCase() === a.payer.toLowerCase() ? "homeowner" : address?.toLowerCase() === a.payee.toLowerCase() ? "contractor" : null;
  const status = ProjectStatus[p.status];
  const t = current.data as unknown as Tranche | undefined;
  const trancheStatus = t ? TrancheStatus[t.status] : undefined;
  const society = a.payerRef > BigInt(0);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">Project #{id}</h1>
          <StatusChip kind="project" value={p.status} enumValues={ProjectStatus} />
        </div>
        <div className="grid gap-3 text-sm sm:grid-cols-3">
          <div><p className="text-xs uppercase text-slate-500">{society ? "Paid by" : "Homeowner"}</p>{society ? `Society #${a.payerRef} treasury` : <AddressLink address={a.payer} />}</div>
          <div><p className="text-xs uppercase text-slate-500">Contractor</p><AddressLink address={a.payee} /></div>
          {role && <div><p className="text-xs uppercase text-slate-500">You are</p>the {role}</div>}
        </div>
        {society && <p className="text-xs text-slate-500">The society committee approves, reworks or disputes this project&apos;s milestones through WorkDecision proposals on the society page.</p>}
      </header>

      {role && <SignInHint what="the line items, reference images, site photos and the AI's findings" />}

      <section className="card space-y-2">
        <h2 className="font-semibold text-slate-900">Milestones</h2>
        <ol className="space-y-2">
          {Array.from({ length: a.trancheCount }, (_, i) => <MilestoneStep key={i} id={id} idx={i} isCurrent={status === "Active" && i === a.current} />)}
        </ol>
      </section>

      {status === "AwaitingAcceptance" && <AwaitingAcceptanceWithFirst id={id} role={role} />}
      {status === "Active" && t && trancheStatus === "Open" && <OpenMilestone id={id} idx={a.current} t={t} role={society && role === "homeowner" ? null : role} />}
      {status === "Active" && t && (trancheStatus === "Claimed" || trancheStatus === "Disputed") && (
        <ClaimedMilestone id={id} idx={a.current} t={t} a={a} role={society ? null : role} />
      )}
      {trancheStatus === "Disputed" && <DisputeStatus escrow={m.address} agreementId={id} idx={a.current} />}
      {status === "Completed" && <Notice>All milestones are approved and paid. The contractor&apos;s passport records a completed project.</Notice>}
      {status === "Cancelled" && <Notice>The project was cancelled. Everything not yet released was refunded to the payer.</Notice>}

      <section className="card space-y-3">
        <h2 className="font-semibold text-slate-900">On-chain history</h2>
        <Timeline contract="milestone" id={id} />
      </section>
    </div>
  );
}

function AwaitingAcceptanceWithFirst({ id, role }: { id: string; role: Role }) {
  const { contracts } = useNest();
  const first = useReadContract({ address: contracts.milestone.address!, abi: contracts.milestone.abi, functionName: "getTranche", args: [BigInt(id), 0] });
  return <AwaitingAcceptance id={id} role={role} first={first.data as unknown as Tranche | undefined} />;
}

function MilestoneStep({ id, idx, isCurrent }: { id: string; idx: number; isCurrent: boolean }) {
  const { contracts } = useNest();
  const m = contracts.milestone;
  const t = useReadContract({ address: m.address!, abi: m.abi, functionName: "getTranche", args: [BigInt(id), idx], query: { refetchInterval: 4000 } }).data as unknown as Tranche | undefined;
  const title = useReadContract({ address: m.address!, abi: m.abi, functionName: "milestoneTitle", args: [BigInt(id), idx] }).data as string | undefined;
  return (
    <li className={`flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 ${isCurrent ? "border-accent" : "border-slate-200"}`}>
      <div>
        <p className="text-sm font-medium text-slate-800">{idx + 1}. {title ?? "…"}</p>
        {t && (
          <p className="text-xs text-slate-600">
            <Amount wei={t.amount} inline /> · advance <Amount wei={t.advance} inline /> · paid so far <Amount wei={t.released} inline />
          </p>
        )}
      </div>
      {t && <StatusChip kind="tranche" value={t.status} enumValues={TrancheStatus} />}
    </li>
  );
}
