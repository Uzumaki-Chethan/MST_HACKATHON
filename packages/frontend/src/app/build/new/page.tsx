"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { decodeEventLog, isAddress } from "viem";
import { useAccount, useReadContract } from "wagmi";
import { inrToWei, milestoneEscrowAbi, WINDOWS, type WindowPreset } from "@nestledger/shared";
import type { MilestoneSpec, ProjectSpec } from "@nestledger/shared/schemas";
import { Amount } from "@/components/Amount";
import { Notice, RequireDeployed, RequireWallet } from "@/components/Gates";
import { useNest } from "@/hooks/useNest";
import { useTx } from "@/hooks/useTx";
import { postManifest, uploadEvidence } from "@/lib/api";
import { describeError } from "@/lib/labels";

type Line = { description: string; inr: number };
type Vp = { id: string; description: string; file?: File };
type Ms = { title: string; lines: Line[]; advancePct: number; checklist: string; vantages: Vp[] };

const input = "mt-1 w-full rounded-md border border-slate-300 px-3 py-2";
// SPEC §2.4 default template: 20% demolition / 30% civil + electrical / 30% finishing / 20% handover.
const TEMPLATE: [string, number][] = [["Demolition", 20], ["Civil + electrical", 30], ["Finishing", 30], ["Handover", 20]];

const fromTemplate = (budget: number): Ms[] =>
  TEMPLATE.map(([title, pct], i) => ({
    title,
    lines: [{ description: `${title} work`, inr: Math.round((budget * pct) / 100) }],
    advancePct: 30,
    checklist: "Work matches the agreed design\nSite left clean",
    vantages: [{ id: `m${i + 1}-wide`, description: "Wide view of the work area" }],
  }));

export default function NewProjectPage() {
  const { contracts } = useNest();
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">Start a renovation project</h1>
      <p className="text-sm text-slate-600">
        You fund the whole budget into the MilestoneEscrow contract now. Each milestone pays a materials advance when it opens, and the rest
        only after you approve the work (or stay silent while the AI check is strong enough).
      </p>
      <RequireWallet signedIn>
        <RequireDeployed address={contracts.milestone.address} name="MilestoneEscrow">
          <ProjectForm />
        </RequireDeployed>
      </RequireWallet>
    </div>
  );
}

function ProjectForm() {
  const router = useRouter();
  const { address } = useAccount();
  const { contracts } = useNest();
  const { send, pending } = useTx();
  const [contractor, setContractor] = useState("");
  const [title, setTitle] = useState("Kitchen renovation");
  const [scope, setScope] = useState("");
  const [budget, setBudget] = useState(200000);
  const [preset, setPreset] = useState<WindowPreset>("demo");
  const [milestones, setMilestones] = useState<Ms[]>(() => fromTemplate(200000));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const m = contracts.milestone;
  const next = useReadContract({ address: m.address!, abi: m.abi, functionName: "nextId" });
  const registered = useReadContract({
    address: contracts.registry.address!, abi: contracts.registry.abi, functionName: "isRegistered", args: [contractor as `0x${string}`],
    query: { enabled: isAddress(contractor) },
  });

  const edit = (i: number, patch: Partial<Ms>) => setMilestones(milestones.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const total = milestones.reduce((s, x) => s + x.lines.reduce((a, l) => a + (l.inr || 0), 0), 0);
  const totalWei = milestones.reduce((s, x) => s + x.lines.reduce((a, l) => a + inrToWei(l.inr || 0), BigInt(0)), BigInt(0));
  const contractorOk = isAddress(contractor) && contractor.toLowerCase() !== address?.toLowerCase();
  const problems = [
    !contractorOk && "Enter the contractor's wallet address (not your own).",
    registered.data === false && "The contractor has no NestLedger profile yet.",
    milestones.length > 12 && "At most 12 milestones.",
    milestones.some((x) => !x.lines.length || x.lines.length > 10 || x.lines.some((l) => !(l.inr > 0))) && "Every milestone needs 1–10 line items, each above ₹0.",
    milestones.some((x) => x.advancePct < 0 || x.advancePct > 40) && "Advances are 0–40% of a milestone.",
    milestones.some((x) => !x.vantages.length || new Set(x.vantages.map((v) => v.id)).size !== x.vantages.length) && "Every milestone needs at least one uniquely named photo angle.",
  ].filter(Boolean) as string[];

  const submit = async () => {
    if (!m.address || next.data === undefined) return;
    setBusy(true);
    setError(null);
    try {
      const w = WINDOWS[preset];
      // Reference images are uploaded under the id this project will get; the AI compares site photos against them.
      const projectId = String(next.data);
      const specs: { spec: MilestoneSpec; hash: `0x${string}` }[] = [];
      for (const ms of milestones) {
        const vantagePoints = [];
        for (const v of ms.vantages) {
          let referenceImageHash: `0x${string}` | undefined;
          if (v.file) {
            referenceImageHash = (await uploadEvidence(v.file, {
              context: { type: "project", id: projectId, stage: "design-ref" }, kind: "design", vantageId: v.id, captureMode: "upload",
            })).hash;
          }
          vantagePoints.push({ id: v.id, description: v.description, ...(referenceImageHash ? { referenceImageHash } : {}) });
        }
        const acceptance = ms.checklist.split("\n").map((s) => s.trim()).filter(Boolean);
        const spec: MilestoneSpec = {
          schema: "nestledger.milestone-spec.v1",
          createdAt: new Date().toISOString(),
          title: ms.title,
          lineItems: ms.lines.map((l, index) => ({ index, description: l.description, amountWei: inrToWei(l.inr).toString(), amountINR: l.inr, acceptance })),
          checklist: acceptance.map((text, i) => ({ itemId: `c${i + 1}`, text })),
          vantagePoints,
          designRefs: vantagePoints.flatMap((v) => (v.referenceImageHash ? [v.referenceImageHash] : [])),
        };
        specs.push({ spec, hash: (await postManifest(spec)).hash });
      }
      const projectSpec: ProjectSpec = {
        schema: "nestledger.project-spec.v1",
        createdAt: new Date().toISOString(),
        title,
        scope: scope || title,
        milestoneSpecHashes: specs.map((s) => s.hash),
      };
      const { hash: specHash } = await postManifest(projectSpec);

      const p = {
        contractor: contractor as `0x${string}`, specHash, responseWindow: w.responseWindowProject, reworkWindow: w.reworkWindow,
        minScore: w.minScore, maxRounds: w.maxRounds, payerRef: BigInt(0), flatId: BigInt(0),
      };
      const ms = milestones.map((x, i) => ({
        title: x.title, lineItems: x.lines.map((l) => inrToWei(l.inr)), advanceBps: Math.round(x.advancePct * 100),
        duration: w.milestoneDuration, specHash: specs[i].hash,
      }));
      const { receipt } = await send({ address: m.address, abi: m.abi, functionName: "createProject", args: [p, ms], value: totalWei }, "Create and fund project");
      const created = receipt.logs
        .map((log) => { try { return decodeEventLog({ abi: milestoneEscrowAbi, data: log.data, topics: log.topics }); } catch { return null; } })
        .find((e) => e?.eventName === "ProjectCreated");
      const id = created && "id" in created.args ? String(created.args.id) : projectId;
      router.push(`/build/${id}`);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <label className="block text-sm">
          <span className="text-slate-700">Contractor wallet address</span>
          <input className={`${input} font-mono`} placeholder="0x…" value={contractor} onChange={(e) => setContractor(e.target.value.trim())} />
        </label>
        <label className="block text-sm">
          <span className="text-slate-700">Project title</span>
          <input className={input} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="block text-sm">
          <span className="text-slate-700">Scope (stays off-chain; its hash goes on-chain)</span>
          <textarea className={input} rows={2} value={scope} onChange={(e) => setScope(e.target.value)} />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="text-slate-700">Total budget (₹), split 20/30/30/20</span>
            <div className="flex gap-2">
              <input type="number" min={1} className={input} value={budget} onChange={(e) => setBudget(Number(e.target.value))} />
              <button className="btn-secondary mt-1" onClick={() => setMilestones(fromTemplate(budget))}>Apply</button>
            </div>
          </label>
          <label className="block text-sm">
            <span className="text-slate-700">Timing</span>
            <select className={input} value={preset} onChange={(e) => setPreset(e.target.value as WindowPreset)}>
              <option value="demo">Demo speed (5-minute milestones, 90 s to respond)</option>
              <option value="production">Real world (4-week milestones, 5 days to respond)</option>
            </select>
          </label>
        </div>
        <p className="text-xs text-slate-500">
          If you stay silent after a claim, AI-backed items release automatically when the AI match score is at least {WINDOWS[preset].minScore}.
          You can ask for rework up to {WINDOWS[preset].maxRounds} times per milestone.
        </p>
      </div>

      {milestones.map((ms, i) => (
        <div key={i} className="card space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <input className="rounded-md border border-slate-300 px-2 py-1 font-medium" value={ms.title} onChange={(e) => edit(i, { title: e.target.value })} />
            <button className="text-xs text-red-700 underline" onClick={() => setMilestones(milestones.filter((_, j) => j !== i))} disabled={milestones.length === 1}>Remove milestone</button>
          </div>
          <div className="space-y-2">
            {ms.lines.map((l, k) => (
              <div key={k} className="flex gap-2">
                <input className="flex-1 rounded border border-slate-300 px-2 py-1 text-sm" value={l.description}
                  onChange={(e) => edit(i, { lines: ms.lines.map((x, j) => (j === k ? { ...x, description: e.target.value } : x)) })} />
                <input type="number" min={1} className="w-28 rounded border border-slate-300 px-2 py-1 text-right text-sm" value={l.inr}
                  onChange={(e) => edit(i, { lines: ms.lines.map((x, j) => (j === k ? { ...x, inr: Number(e.target.value) } : x)) })} />
                <button className="text-xs text-slate-500" onClick={() => edit(i, { lines: ms.lines.filter((_, j) => j !== k) })} aria-label="Remove line">×</button>
              </div>
            ))}
            <button className="text-xs text-accent underline" disabled={ms.lines.length >= 10}
              onClick={() => edit(i, { lines: [...ms.lines, { description: "", inr: 0 }] })}>Add line item</button>
          </div>
          <label className="block text-sm">
            <span className="text-slate-700">Materials advance: {ms.advancePct}% (paid to the contractor when this milestone opens)</span>
            <input type="range" min={0} max={40} step={5} className="w-full" value={ms.advancePct} onChange={(e) => edit(i, { advancePct: Number(e.target.value) })} />
          </label>
          <label className="block text-sm">
            <span className="text-slate-700">Acceptance checklist (one per line)</span>
            <textarea className={input} rows={2} value={ms.checklist} onChange={(e) => edit(i, { checklist: e.target.value })} />
          </label>
          <div className="space-y-2">
            <p className="text-sm text-slate-700">Photo angles (the contractor must photograph each; add a reference or design image to compare against)</p>
            {ms.vantages.map((v, k) => (
              <div key={k} className="flex flex-wrap items-center gap-2 text-sm">
                <input className="w-32 rounded border border-slate-300 px-2 py-1 font-mono text-xs" value={v.id}
                  onChange={(e) => edit(i, { vantages: ms.vantages.map((x, j) => (j === k ? { ...x, id: e.target.value.replace(/\s+/g, "-") } : x)) })} />
                <input className="flex-1 rounded border border-slate-300 px-2 py-1" value={v.description}
                  onChange={(e) => edit(i, { vantages: ms.vantages.map((x, j) => (j === k ? { ...x, description: e.target.value } : x)) })} />
                <input type="file" accept="image/*" className="text-xs"
                  onChange={(e) => edit(i, { vantages: ms.vantages.map((x, j) => (j === k ? { ...x, file: e.target.files?.[0] } : x)) })} />
              </div>
            ))}
            <button className="text-xs text-accent underline"
              onClick={() => edit(i, { vantages: [...ms.vantages, { id: `m${i + 1}-view${ms.vantages.length + 1}`, description: "" }] })}>Add angle</button>
          </div>
        </div>
      ))}
      <button className="btn-secondary" disabled={milestones.length >= 12}
        onClick={() => setMilestones([...milestones, { title: `Milestone ${milestones.length + 1}`, lines: [{ description: "", inr: 0 }], advancePct: 30, checklist: "", vantages: [{ id: `m${milestones.length + 1}-wide`, description: "Wide view" }] }])}>
        Add milestone
      </button>

      <div className="card space-y-2">
        <p className="text-sm">You fund now: <Amount wei={totalWei} inline /> <span className="text-xs text-slate-500">(₹{total.toLocaleString("en-IN")} across {milestones.length} milestones)</span></p>
        {problems.map((p) => <Notice key={p} tone="warn">{p}</Notice>)}
        {error && <p className="text-sm text-red-700">{error}</p>}
        <button className="btn-primary w-full" disabled={busy || pending || problems.length > 0 || next.data === undefined} onClick={submit}>
          {busy || pending ? "Working…" : "Create and fund project"}
        </button>
      </div>
    </div>
  );
}
