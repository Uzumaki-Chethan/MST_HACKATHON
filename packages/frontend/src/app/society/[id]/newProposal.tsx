"use client";

// New society proposal (SPEC §2.3 step 3, §5.8 dispatch-by-kind data encodings).
import { useState } from "react";
import { encodeAbiParameters, isAddress, type AbiParameter } from "viem";
import { useReadContract } from "wagmi";
import { inrToWei, milestoneEscrowAbi, weiToInr, WINDOWS, type WindowPreset } from "@nestledger/shared";
import type { InvoiceDoc, InvoiceReport, MilestoneSpec, Note, ProjectSpec } from "@nestledger/shared/schemas";
import { Amount } from "@/components/Amount";
import { SimulatedBadge } from "@/components/Badges";
import { Notice } from "@/components/Gates";
import type { SocietyData } from "@/hooks/useSociety";
import { useNest } from "@/hooks/useNest";
import { useTx } from "@/hooks/useTx";
import { aiInvoicePreview, postManifest, uploadEvidence } from "@/lib/api";
import { describeError } from "@/lib/labels";
import type { Tranche } from "@/lib/lease";

const input = "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
const CATEGORIES: InvoiceDoc["category"][] = ["plumbing", "electrical", "cleaning", "security", "water", "lift", "garden", "painting", "civil", "other"];
const createProjectInputs = (milestoneEscrowAbi as readonly { type: string; name?: string; inputs?: readonly AbiParameter[] }[])
  .find((x) => x.type === "function" && x.name === "createProject")!.inputs!;

type Kind = 0 | 1 | 2;

/** BuildSafe is out of the demo (team decision 29 Sep), so the works proposal kinds are hidden; flip to show them. */
const SHOW_WORKS = false;

export function NewProposal({ id, data }: { id: string; data: SocietyData }) {
  const [kind, setKind] = useState<Kind>(0);
  const [preset, setPreset] = useState<WindowPreset>("demo");
  return (
    <div className="card space-y-4">
      <h3 className="font-semibold text-slate-900">{SHOW_WORKS ? "New proposal (committee)" : "Pay a vendor (committee proposal)"}</h3>
      {SHOW_WORKS && (
        <div className="flex flex-wrap gap-2">
          {(["Pay a vendor", "Fund a works project", "Decide on a works milestone"] as const).map((t, k) => (
            <button key={t} className={k === kind ? "btn-primary" : "btn-secondary"} onClick={() => setKind(k as Kind)}>{t}</button>
          ))}
        </div>
      )}
      <p className="text-xs text-slate-500">
        Available to spend: <Amount wei={data.available} inline />. The amount is reserved as soon as you propose, so parallel proposals can&apos;t overspend.
      </p>
      {kind === 0 && <PayVendor id={id} />}
      {kind === 1 && <FundWork id={id} preset={preset} setPreset={setPreset} />}
      {kind === 2 && <WorkDecision id={id} data={data} />}
    </div>
  );
}

function usePropose() {
  const { contracts } = useNest();
  const { send, pending } = useTx();
  const [error, setError] = useState<string | null>(null);
  const propose = async (label: string, args: { societyId: string; kind: Kind; payee: string; amount: bigint; docHash: `0x${string}`; category: string; data: `0x${string}` }) => {
    setError(null);
    try {
      await send({
        address: contracts.ledger.address!, abi: contracts.ledger.abi, functionName: "propose",
        args: [BigInt(args.societyId), args.kind, args.payee, args.amount, args.docHash, args.category, args.data],
      }, label);
      return true;
    } catch (e) {
      setError(describeError(e));
      return false;
    }
  };
  return { propose, pending, error, setError };
}

// ---------------------------------------------------------------- PayVendor

function PayVendor({ id }: { id: string }) {
  const { propose, pending, error, setError } = usePropose();
  const [payee, setPayee] = useState("");
  const [inr, setInr] = useState(4800);
  const [category, setCategory] = useState<InvoiceDoc["category"]>("plumbing");
  const [files, setFiles] = useState<File[]>([]);
  const [docHash, setDocHash] = useState<`0x${string}` | null>(null);
  const [preview, setPreview] = useState<InvoiceReport | null>(null);
  const [busy, setBusy] = useState(false);
  const ok = isAddress(payee) && inr > 0 && files.length > 0;

  const check = async () => {
    setBusy(true);
    setError(null);
    setPreview(null);
    try {
      const hashes = [];
      for (const f of files) {
        hashes.push((await uploadEvidence(f, { context: { type: "society", id, stage: "invoice" }, kind: "invoice", captureMode: "upload" })).hash);
      }
      const doc: InvoiceDoc = {
        schema: "nestledger.invoice.v1", createdAt: new Date().toISOString(), societyId: id, payee: payee.toLowerCase(),
        declaredAmountWei: inrToWei(inr).toString(), declaredAmountINR: inr, category, files: hashes,
      };
      const { hash } = await postManifest(doc);
      setDocHash(hash);
      try {
        setPreview((await aiInvoicePreview(id, hash, payee as `0x${string}`, inrToWei(inr).toString())).report);
      } catch (e) {
        setError(`AI preview unavailable (${describeError(e)}). You can still propose; the AI agent checks it after.`);
      }
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-sm sm:col-span-2"><span className="text-slate-700">Vendor wallet</span>
          <input className={`${input} font-mono`} placeholder="0x…" value={payee} onChange={(e) => { setPayee(e.target.value.trim()); setDocHash(null); }} /></label>
        <label className="block text-sm"><span className="text-slate-700">Amount (₹)</span>
          <input type="number" min={1} className={input} value={inr} onChange={(e) => { setInr(Number(e.target.value)); setDocHash(null); }} /></label>
        <label className="block text-sm"><span className="text-slate-700">Category</span>
          <select className={input} value={category} onChange={(e) => { setCategory(e.target.value as InvoiceDoc["category"]); setDocHash(null); }}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select></label>
        <label className="block text-sm sm:col-span-2"><span className="text-slate-700">Invoice photo(s), public on the transparency page</span>
          <input type="file" accept="image/*" multiple className="mt-1 text-sm" onChange={(e) => { setFiles([...(e.target.files ?? [])]); setDocHash(null); }} /></label>
      </div>
      <button className="btn-secondary" disabled={!ok || busy} onClick={check}>{busy ? "Uploading and checking…" : "Upload and run the AI check"}</button>
      {preview && (
        <div className={`rounded-md border p-3 text-sm ${preview.flagged ? "border-red-300 bg-red-50" : "border-accent bg-accent-light"}`}>
          <div className="flex flex-wrap items-center gap-2">
            <SimulatedBadge what={preview.model === "fixtures" ? "AI: fixture mode" : "AI agent"} />
            <span className="font-medium">{preview.flagged ? `Flagged · risk ${preview.riskScore}` : `No flags · risk ${preview.riskScore}`}</span>
          </div>
          <p className="mt-1 text-slate-700">{preview.justification}</p>
          <p className="mt-1 text-xs text-slate-500">
            Read from the invoice: {preview.extraction.vendorName}, #{preview.extraction.invoiceNumber || "?"}, total ₹{preview.extraction.totalINR.toLocaleString("en-IN")}.
            {preview.flagged && " A flag doesn't block the payment: it raises the approval tier and every approver must give a written reason."}
          </p>
        </div>
      )}
      {error && <p className="text-sm text-red-700">{error}</p>}
      {docHash && (
        <button className="btn-primary w-full" disabled={pending}
          onClick={() => propose("Propose payment", { societyId: id, kind: 0, payee, amount: inrToWei(inr), docHash, category, data: "0x" })}>
          Propose paying <Amount wei={inrToWei(inr)} inline />
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- FundWork

type WorkMs = { title: string; inr: number; advancePct: number };

function FundWork({ id, preset, setPreset }: { id: string; preset: WindowPreset; setPreset: (p: WindowPreset) => void }) {
  const { propose, pending, error, setError } = usePropose();
  const [contractor, setContractor] = useState("");
  const [title, setTitle] = useState("Lobby repainting");
  const [ms, setMs] = useState<WorkMs[]>([{ title: "Surface preparation", inr: 30000, advancePct: 30 }, { title: "Painting and handover", inr: 50000, advancePct: 20 }]);
  const totalWei = ms.reduce((s, m) => s + inrToWei(m.inr || 0), BigInt(0));
  const ok = isAddress(contractor) && ms.length > 0 && ms.every((m) => m.title.trim() && m.inr > 0 && m.advancePct >= 0 && m.advancePct <= 40);

  const submit = async () => {
    setError(null);
    try {
      const w = WINDOWS[preset];
      const specHashes: `0x${string}`[] = [];
      for (const [i, m] of ms.entries()) {
        const spec: MilestoneSpec = {
          schema: "nestledger.milestone-spec.v1", createdAt: new Date().toISOString(), title: m.title,
          lineItems: [{ index: 0, description: m.title, amountWei: inrToWei(m.inr).toString(), amountINR: m.inr, acceptance: ["Work matches the agreed scope"] }],
          checklist: [{ itemId: "c1", text: "Work matches the agreed scope" }],
          vantagePoints: [{ id: `w${i + 1}-wide`, description: "Wide view of the work area" }],
          designRefs: [],
        };
        specHashes.push((await postManifest(spec)).hash);
      }
      const projectSpec: ProjectSpec = { schema: "nestledger.project-spec.v1", createdAt: new Date().toISOString(), title, scope: title, milestoneSpecHashes: specHashes };
      const { hash: specHash } = await postManifest(projectSpec);
      const p = {
        contractor: contractor as `0x${string}`, specHash, responseWindow: w.responseWindowProject, reworkWindow: w.reworkWindow,
        minScore: w.minScore, maxRounds: w.maxRounds, payerRef: BigInt(id), flatId: BigInt(0),
      };
      const milestones = ms.map((m, i) => ({
        title: m.title, lineItems: [inrToWei(m.inr)], advanceBps: Math.round(m.advancePct * 100), duration: w.milestoneDuration, specHash: specHashes[i],
      }));
      const data = encodeAbiParameters(createProjectInputs, [p, milestones]);
      await propose("Propose works project", { societyId: id, kind: 1, payee: contractor, amount: totalWei, docHash: specHash, category: "works", data });
    } catch (e) {
      setError(describeError(e));
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm"><span className="text-slate-700">Contractor wallet</span>
          <input className={`${input} font-mono`} placeholder="0x…" value={contractor} onChange={(e) => setContractor(e.target.value.trim())} /></label>
        <label className="block text-sm"><span className="text-slate-700">Project title</span>
          <input className={input} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label className="block text-sm sm:col-span-2"><span className="text-slate-700">Timing</span>
          <select className={input} value={preset} onChange={(e) => setPreset(e.target.value as WindowPreset)}>
            <option value="demo">Demo speed</option><option value="production">Real world</option>
          </select></label>
      </div>
      {ms.map((m, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
          <input className="flex-1 rounded border border-slate-300 px-2 py-1" value={m.title} onChange={(e) => setMs(ms.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
          <input type="number" min={1} className="w-28 rounded border border-slate-300 px-2 py-1 text-right" value={m.inr} onChange={(e) => setMs(ms.map((x, j) => (j === i ? { ...x, inr: Number(e.target.value) } : x)))} />
          <label className="text-xs text-slate-600">advance % <input type="number" min={0} max={40} className="w-14 rounded border border-slate-300 px-1 py-1" value={m.advancePct} onChange={(e) => setMs(ms.map((x, j) => (j === i ? { ...x, advancePct: Number(e.target.value) } : x)))} /></label>
          <button className="text-xs text-slate-500" onClick={() => setMs(ms.filter((_, j) => j !== i))} disabled={ms.length === 1}>×</button>
        </div>
      ))}
      <button className="text-xs text-accent underline" disabled={ms.length >= 12} onClick={() => setMs([...ms, { title: "", inr: 0, advancePct: 30 }])}>Add milestone</button>
      <p className="text-xs text-slate-500">
        When executed, the treasury funds a BuildSafe project (<Amount wei={totalWei} inline />) paid by this society. The committee then accepts,
        reworks or disputes each milestone with &quot;Decide on a works milestone&quot; proposals.
      </p>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <button className="btn-primary w-full" disabled={!ok || pending} onClick={submit}>Propose the works project</button>
    </div>
  );
}

// ---------------------------------------------------------------- WorkDecision

function WorkDecision({ id, data }: { id: string; data: SocietyData }) {
  const { contracts } = useNest();
  const { propose, pending, error, setError } = usePropose();
  const projects = data.proposals.filter((p) => p.kind === 1 && p.resultRef > BigInt(0)).map((p) => p.resultRef);
  const [projectId, setProjectId] = useState<string>(projects[0] ? String(projects[0]) : "");
  const [action, setAction] = useState<0 | 1 | 2>(0);
  const [mask, setMask] = useState(0);
  const [reason, setReason] = useState("");
  const m = contracts.milestone;
  const agreement = useReadContract({ address: m.address!, abi: m.abi, functionName: "getAgreement", args: [BigInt(projectId || 0)], query: { enabled: !!projectId && !!m.address } });
  const a = agreement.data as unknown as { payee: `0x${string}`; current: number } | undefined;
  const tranche = useReadContract({ address: m.address!, abi: m.abi, functionName: "getTranche", args: [BigInt(projectId || 0), a?.current ?? 0], query: { enabled: !!a } });
  const t = tranche.data as unknown as Tranche | undefined;
  const bondRead = useReadContract({ address: contracts.resolver.address!, abi: contracts.resolver.abi, functionName: "disputeBond", query: { enabled: !!contracts.resolver.address } });

  if (!projects.length) return <Notice>No works projects yet. Fund one first with &quot;Fund a works project&quot;.</Notice>;
  const needsMask = action !== 0;
  const ok = !!a && !!t && t.status === 2 && (!needsMask || mask !== 0) && reason.trim() && (action !== 1 || bondRead.data !== undefined);

  const submit = async () => {
    setError(null);
    try {
      const note: Note = { schema: "nestledger.note.v1", createdAt: new Date().toISOString(), purpose: action === 2 ? "rework" : "rationale", text: reason.trim(), refs: [`project:${projectId}`] };
      const { hash: reasonHash } = await postManifest(note);
      const data = encodeAbiParameters(
        [{ type: "uint256" }, { type: "uint8" }, { type: "uint16" }, { type: "bytes32" }],
        [BigInt(projectId), action, needsMask ? mask : 0, reasonHash],
      );
      const amount = action === 1 ? (bondRead.data as bigint) : BigInt(0);
      await propose(["Propose: accept milestone", "Propose: dispute items", "Propose: request rework"][action], {
        societyId: id, kind: 2, payee: a!.payee, amount, docHash: reasonHash, category: "works", data,
      });
    } catch (e) {
      setError(describeError(e));
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm"><span className="text-slate-700">Project</span>
          <select className={input} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            {projects.map((p) => <option key={String(p)} value={String(p)}>Project #{String(p)}</option>)}
          </select></label>
        <label className="block text-sm"><span className="text-slate-700">Decision</span>
          <select className={input} value={action} onChange={(e) => { setAction(Number(e.target.value) as 0 | 1 | 2); setMask(0); }}>
            <option value={0}>Accept the milestone (pay the rest)</option>
            <option value={2}>Request rework on items</option>
            <option value={1}>Dispute items (goes to arbiters)</option>
          </select></label>
      </div>
      {t && t.status !== 2 && <Notice>Project #{projectId} has no claim waiting for a decision right now. <a className="text-accent underline" href={`/build/${projectId}`}>Open the project</a>.</Notice>}
      {t && t.status === 2 && needsMask && (
        <div className="flex flex-wrap gap-3 text-sm">
          {t.itemCaps.map((cap, i) => (
            <label key={i} className="flex items-center gap-1">
              <input type="checkbox" checked={(mask & (1 << i)) !== 0} onChange={(e) => setMask(e.target.checked ? mask | (1 << i) : mask & ~(1 << i))} />
              Item {i + 1} (<Amount wei={cap} inline />)
            </label>
          ))}
        </div>
      )}
      <textarea className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" rows={2} placeholder="Reason (published with the proposal)"
        value={reason} onChange={(e) => setReason(e.target.value)} />
      <p className="text-xs text-slate-500">Work decisions always need {data.society.config.threshold} committee approvals (tier 1 or higher).{action === 1 && bondRead.data !== undefined && <> The dispute bond (<Amount wei={bondRead.data as bigint} inline />) comes from the treasury.</>}</p>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <button className="btn-primary w-full" disabled={!ok || pending} onClick={submit}>Propose this decision</button>
    </div>
  );
}

