"use client";

// Project page action panels (SPEC §2.4, §8.3 /build/[id]).
import { useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useReadContract } from "wagmi";
import type { Vantage } from "@nestledger/shared";
import type { AttestationReport, MilestoneClaim, MilestoneReport, MilestoneSpec, Note } from "@nestledger/shared/schemas";
import { Amount } from "@/components/Amount";
import { SimulatedBadge } from "@/components/Badges";
import { CaptureWizard } from "@/components/CaptureWizard";
import { Countdown } from "@/components/Countdown";
import { EvidenceImage, photoByVantage, useBundle, useReport } from "@/components/Evidence";
import { Notice } from "@/components/Gates";
import { useNest } from "@/hooks/useNest";
import { useTx } from "@/hooks/useTx";
import { aiMilestonePreview, fetchEvidenceObjectUrl, getManifest, postManifest } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { describeError } from "@/lib/labels";
import { bit, type Attestation, type Claim, type Tranche } from "@/lib/lease";

export type Agreement = {
  payer: `0x${string}`; payee: `0x${string}`; payerRef: bigint; responseWindow: number; minScore: number;
  maxRounds: number; trancheCount: number; current: number; closed: boolean;
};
export type Role = "homeowner" | "contractor" | null;

const now = () => Math.floor(Date.now() / 1000);
const STATUS_TEXT: Record<string, [string, string]> = {
  complete: ["Complete", "text-accent-dark"],
  partial: ["Partly done", "text-amber-700"],
  not_done: ["Not done", "text-red-700"],
  cannot_verify: ["Can't verify from photos", "text-slate-500"],
};

export function useSpec(specHash?: string) {
  const { session } = useAuth();
  return useQuery({
    queryKey: ["manifest", specHash],
    queryFn: () => getManifest<MilestoneSpec>(specHash!),
    enabled: !!session && !!specHash,
    staleTime: Infinity,
    retry: false,
  });
}

function useReferenceUrls(spec?: MilestoneSpec) {
  const refs = (spec?.vantagePoints ?? []).filter((v) => v.referenceImageHash);
  const urls = useQueries({
    queries: refs.map((v) => ({ queryKey: ["evidence-url", v.referenceImageHash], queryFn: () => fetchEvidenceObjectUrl(v.referenceImageHash!), staleTime: Infinity })),
  });
  return Object.fromEntries(refs.map((v, i) => [v.id, urls[i]?.data]).filter(([, u]) => u)) as Record<string, string>;
}

// ---------------------------------------------------------------- accept / cancel

export function AwaitingAcceptance({ id, role, first }: { id: string; role: Role; first?: Tranche }) {
  const { contracts } = useNest();
  const { send, pending } = useTx();
  const m = contracts.milestone;
  if (role === "contractor") {
    return (
      <section className="card space-y-3">
        <h2 className="font-semibold text-slate-900">Accept the project</h2>
        <p className="text-sm text-slate-700">
          The full budget is already locked in the contract. Accepting opens milestone 1 and pays its materials advance
          {first && <> (<Amount wei={first.advance} inline />)</>} to you straight away.
        </p>
        <button className="btn-primary w-full" disabled={pending}
          onClick={() => send({ address: m.address!, abi: m.abi, functionName: "acceptProject", args: [BigInt(id)] }, "Accept project").catch(() => undefined)}>
          Accept and receive the first advance
        </button>
      </section>
    );
  }
  if (role === "homeowner") {
    return (
      <section className="card flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-700">Waiting for the contractor to accept. Until then you can cancel and get the whole budget back.</p>
        <button className="btn-secondary" disabled={pending}
          onClick={() => send({ address: m.address!, abi: m.abi, functionName: "cancelUnaccepted", args: [BigInt(id)] }, "Cancel project").catch(() => undefined)}>
          Cancel and refund
        </button>
      </section>
    );
  }
  return <Notice>Waiting for the contractor to accept.</Notice>;
}

// ---------------------------------------------------------------- open milestone: contractor claims

export function OpenMilestone({ id, idx, t, role }: { id: string; idx: number; t: Tranche; role: Role }) {
  const { contracts } = useNest();
  const { send, pending } = useTx();
  const spec = useSpec(t.specHash);
  const ghosts = useReferenceUrls(spec.data);
  const [open, setOpen] = useState(false);
  const [bundleHash, setBundleHash] = useState<`0x${string}` | null>(null);
  const [preview, setPreview] = useState<{ report: MilestoneReport; reportHash: `0x${string}`; supportedPreview: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const m = contracts.milestone;
  const deadline = Number(t.claimDeadline);

  if (role !== "contractor") {
    return (
      <section className="card space-y-2">
        <p className="text-sm text-slate-700">
          Waiting for the contractor to finish this milestone and claim. Deadline: <Countdown until={deadline}>
            {role === "homeowner" ? (
              <button className="btn-secondary" disabled={pending}
                onClick={() => send({ address: m.address!, abi: m.abi, functionName: "finalizeNoClaim", args: [BigInt(id)] }, "Cancel stalled project").catch(() => undefined)}>
                Cancel the stalled project
              </button>
            ) : <span className="text-sm text-slate-500">passed</span>}
          </Countdown>
        </p>
        {role === "homeowner" && (
          <p className="text-xs text-slate-500">
            After the deadline you may cancel: everything not yet released comes back to you, and the contractor&apos;s passport records an abandoned
            project. You can also keep waiting; a late claim is still accepted and recorded as late.
          </p>
        )}
      </section>
    );
  }

  const vantages: Vantage[] = (spec.data?.vantagePoints ?? []).map((v) => ({ room: "site", vantageId: v.id, label: v.description || v.id }));
  const analyse = async (hash: `0x${string}`) => {
    setBundleHash(hash);
    setBusy(true);
    setError(null);
    try {
      setPreview(await aiMilestonePreview(id, idx, hash));
    } catch (e) {
      setError(`${describeError(e)} You can still claim; without an AI check nothing is backed, so silence sends it to arbiters.`);
    } finally {
      setBusy(false);
    }
  };
  const claim = async () => {
    if (!bundleHash) return;
    setError(null);
    try {
      const manifest: MilestoneClaim = {
        schema: "nestledger.claim.milestone.v1",
        createdAt: new Date().toISOString(),
        projectId: id,
        milestoneIndex: idx,
        round: t.round,
        photosBundleHash: bundleHash,
        ...(preview ? { previewReportHash: preview.reportHash } : {}),
        lineItems: t.itemCaps.map((cap, index) => ({ index, claimedWei: cap.toString() })),
      };
      const { hash } = await postManifest(manifest);
      await send({ address: m.address!, abi: m.abi, functionName: "submitClaim", args: [BigInt(id), [...t.itemCaps], hash] }, "Claim milestone");
    } catch (e) {
      setError(describeError(e));
    }
  };

  return (
    <section className="card space-y-3">
      <h2 className="font-semibold text-slate-900">Finish and claim this milestone{t.round > 0 && ` (rework round ${t.round})`}</h2>
      <p className="text-sm text-slate-600">
        Photograph each agreed angle, lined up with the reference image shown as a ghost. The AI checks your photos against the design and
        checklist before you claim. Deadline: <Countdown until={deadline}><span className="text-sm text-amber-700">passed; a claim now is recorded as late</span></Countdown>
      </p>
      {!spec.data && <p className="text-sm text-slate-500">Loading the milestone spec…</p>}
      {spec.data && !open && <button className="btn-primary" onClick={() => setOpen(true)}>Start the photo walkthrough</button>}
      {spec.data && open && !bundleHash && (
        <CaptureWizard context={{ type: "project", id, stage: "milestone" }} vantages={vantages} ghosts={ghosts} onDone={(h) => analyse(h)} />
      )}
      {busy && <p className="text-sm text-slate-600">The AI is comparing your photos with the design…</p>}
      {error && <p className="text-sm text-red-700">{error}</p>}
      {preview && <ReportView report={preview.report} caps={t.itemCaps} supported={preview.supportedPreview.map((s) => BigInt(s))} spec={spec.data} />}
      {bundleHash && !busy && (
        <button className="btn-primary w-full" disabled={pending} onClick={claim}>Claim the milestone&apos;s line items</button>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- claimed: homeowner decides

function ReportView({ report, caps, supported, spec, backedMask }: {
  report: MilestoneReport; caps: readonly bigint[]; supported?: readonly bigint[]; spec?: MilestoneSpec; backedMask?: number;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <SimulatedBadge what={report.model === "fixtures" ? "AI: fixture mode" : "AI agent"} />
        <span className="text-sm font-medium text-slate-800">Match score {report.scoreUsed}/100</span>
        <span className="text-sm text-slate-600">{report.summary}</span>
      </div>
      <ul className="space-y-2">
        {caps.map((cap, i) => {
          const line = report.lineItems.find((l) => l.index === i);
          const [text, tone] = STATUS_TEXT[line?.status ?? "cannot_verify"];
          return (
            <li key={i} className="rounded-md border border-slate-200 p-3 text-sm">
              <div className="flex flex-wrap justify-between gap-2">
                <span className="font-medium text-slate-800">{spec?.lineItems.find((l) => l.index === i)?.description ?? `Line item ${i + 1}`}</span>
                <span className={`font-medium ${tone}`}>{text}</span>
              </div>
              <p className="text-xs text-slate-600">
                <Amount wei={cap} inline />{supported && <> · AI supports <Amount wei={supported[i] ?? BigInt(0)} inline /></>}
              </p>
              {line?.evidence && <p className="text-xs text-slate-500">{line.evidence}</p>}
              {line?.discrepancies.map((d) => <p key={d.description} className={`text-xs ${d.severity === "major" ? "text-red-700" : "text-amber-700"}`}>{d.severity === "major" ? "Major" : "Minor"}: {d.description}</p>)}
              {backedMask !== undefined && (
                <p className={`text-xs font-medium ${bit(backedMask, i) ? "text-accent-dark" : "text-red-700"}`}>
                  {bit(backedMask, i) ? "✓ Backed: releases if the homeowner stays silent" : "✗ Not backed: goes to arbiters if the homeowner stays silent"}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      {report.checklist.length > 0 && (
        <p className="text-xs text-slate-600">Checklist: {report.checklist.map((c) => `${c.result === "pass" ? "✓" : c.result === "fail" ? "✗" : "?"} ${spec?.checklist.find((x) => x.itemId === c.itemId)?.text ?? c.itemId}`).join(" · ")}</p>
      )}
    </div>
  );
}

export function ClaimedMilestone({ id, idx, t, a, role }: { id: string; idx: number; t: Tranche; a: Agreement; role: Role }) {
  const { contracts } = useNest();
  const { send, pending } = useTx();
  const { session } = useAuth();
  const m = contracts.milestone;
  const q = { refetchInterval: 4000 };
  const claim = useReadContract({ address: m.address!, abi: m.abi, functionName: "getClaim", args: [BigInt(id), idx], query: q }).data as unknown as Claim | undefined;
  const att = useReadContract({ address: m.address!, abi: m.abi, functionName: "getAttestation", args: [BigInt(id), idx], query: q }).data as unknown as Attestation | undefined;
  const backed = useReadContract({ address: m.address!, abi: m.abi, functionName: "backedMask", args: [BigInt(id)], query: q }).data;
  const bond = useReadContract({ address: contracts.resolver.address!, abi: contracts.resolver.abi, functionName: "disputeBond", query: { enabled: !!contracts.resolver.address } });
  const spec = useSpec(t.specHash);
  const manifest = useQuery({
    queryKey: ["manifest", claim?.evidenceHash], queryFn: () => getManifest<MilestoneClaim>(claim!.evidenceHash),
    enabled: !!session && !!claim, retry: false,
  });
  const attested = !!att && att.attestedAt > BigInt(0);
  const wrapper = useReport<AttestationReport>(attested ? att!.reportHash : null);
  const report = useReport<MilestoneReport>(wrapper.data?.sourceReportHash ?? manifest.data?.previewReportHash);
  const site = useBundle(manifest.data?.photosBundleHash);
  const sitePhotos = photoByVantage(site.data);
  const [mask, setMask] = useState(0);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!claim) return <p className="text-sm text-slate-500">Loading the claim…</p>;
  const deadline = Number(claim.submittedAt) + a.responseWindow;
  const inWindow = now() <= deadline;
  const canDecide = role === "homeowner" && t.status === 2 && inWindow;
  const canRework = canDecide && t.round < a.maxRounds;

  const rework = async () => {
    setError(null);
    try {
      const note: Note = { schema: "nestledger.note.v1", createdAt: new Date().toISOString(), purpose: "rework", text: reason.trim(), refs: [`project:${id}`, `milestone:${idx}`] };
      const { hash } = await postManifest(note);
      await send({ address: m.address!, abi: m.abi, functionName: "requestRework", args: [BigInt(id), mask, hash] }, "Request rework");
    } catch (e) {
      setError(describeError(e));
    }
  };

  return (
    <section className="card space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold text-slate-900">Review the contractor&apos;s claim</h2>
        {claim.late && <span className="chip bg-amber-100 text-amber-800">Claimed late</span>}
        {!attested && <span className="text-xs text-slate-500">Waiting for the AI agent&apos;s attestation…</span>}
      </div>

      {spec.data && (
        <div className="grid gap-3 sm:grid-cols-2">
          {spec.data.vantagePoints.map((v) => (
            <div key={v.id} className="space-y-1">
              <p className="text-xs font-medium text-slate-600">{v.description || v.id}</p>
              <div className="grid grid-cols-2 gap-2">
                <figure><EvidenceImage hash={v.referenceImageHash} alt={`${v.id} reference`} className="h-28 w-full rounded" /><figcaption className="text-xs text-slate-500">Agreed reference</figcaption></figure>
                <figure><EvidenceImage hash={sitePhotos.get(v.id)} alt={`${v.id} site`} className="h-28 w-full rounded" /><figcaption className="text-xs text-slate-500">Site now</figcaption></figure>
              </div>
            </div>
          ))}
        </div>
      )}

      {report.data ? (
        <ReportView report={report.data} caps={claim.items} supported={attested ? att!.supported : undefined} spec={spec.data} backedMask={backed !== undefined ? Number(backed) : undefined} />
      ) : (
        <p className="text-sm text-slate-500">{session ? "Loading the AI check…" : "Sign in to see the photos and the AI check."}</p>
      )}

      {t.status === 2 && (
        <p className="text-sm text-slate-700">
          {role === "homeowner" ? "Decide" : "The homeowner decides"} within{" "}
          <Countdown until={deadline}>
            <button className="btn-secondary" disabled={pending}
              onClick={() => send({ address: m.address!, abi: m.abi, functionName: "finalizeAfterSilence", args: [BigInt(id)] }, "Finalise after silence").catch(() => undefined)}>
              Finalise now
            </button>
          </Countdown>
          . If there is no decision, backed items release to the contractor (AI score {attested ? att!.score : "…"}, needs at least {a.minScore}) and the rest go to arbiters.
        </p>
      )}

      {canDecide && (
        <div className="space-y-3 border-t border-slate-100 pt-3">
          <p className="text-sm text-slate-700">Select line items to send back for rework or to dispute:</p>
          <div className="flex flex-wrap gap-3">
            {claim.items.map((_, i) => (
              <label key={i} className="flex items-center gap-1 text-sm">
                <input type="checkbox" checked={bit(mask, i)} onChange={(e) => setMask(e.target.checked ? mask | (1 << i) : mask & ~(1 << i))} />
                {spec.data?.lineItems.find((l) => l.index === i)?.description ?? `Item ${i + 1}`}
              </label>
            ))}
          </div>
          {canRework && (
            <textarea className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" rows={2} placeholder="What needs fixing (required for rework)"
              value={reason} onChange={(e) => setReason(e.target.value)} />
          )}
          {error && <p className="text-sm text-red-700">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" disabled={pending}
              onClick={() => send({ address: m.address!, abi: m.abi, functionName: "respond", args: [BigInt(id), 0] }, "Approve milestone").catch(() => undefined)}>
              Approve: pay the rest of this milestone
            </button>
            {canRework && (
              <button className="btn-secondary" disabled={pending || mask === 0 || !reason.trim()} onClick={rework}>
                Request rework ({a.maxRounds - t.round} left)
              </button>
            )}
            <button className="btn-secondary" disabled={pending || mask === 0 || bond.data === undefined}
              onClick={() => send({ address: m.address!, abi: m.abi, functionName: "respond", args: [BigInt(id), mask], value: bond.data as bigint }, "Dispute items").catch(() => undefined)}>
              Dispute selected{bond.data !== undefined && <> (bond <Amount wei={bond.data as bigint} inline />)</>}
            </button>
          </div>
          {!contracts.resolver.address && <p className="text-xs text-slate-500">Disputes open once the DisputeResolver contract is deployed.</p>}
        </div>
      )}
    </section>
  );
}
