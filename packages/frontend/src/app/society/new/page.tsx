"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { decodeEventLog, isAddress } from "viem";
import { useAccount } from "wagmi";
import { inrToWei, societyLedgerAbi, WINDOWS, type WindowPreset } from "@nestledger/shared";
import type { SocietyMeta } from "@nestledger/shared/schemas";
import { Notice, RequireDeployed, RequireWallet } from "@/components/Gates";
import { useNest } from "@/hooks/useNest";
import { useTx } from "@/hooks/useTx";
import { postManifest } from "@/lib/api";
import { describeError } from "@/lib/labels";

const input = "mt-1 w-full rounded-md border border-slate-300 px-3 py-2";

export default function NewSocietyPage() {
  const { contracts } = useNest();
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Create a society treasury</h1>
      <p className="text-sm text-slate-600">
        Maintenance goes into the SocietyLedger contract, and every payment out needs committee approvals by tier. Anyone can see the
        whole ledger on the public page, without a wallet.
      </p>
      <RequireWallet signedIn>
        <RequireDeployed address={contracts.ledger.address} name="SocietyLedger">
          <SocietyForm />
        </RequireDeployed>
      </RequireWallet>
    </div>
  );
}

function SocietyForm() {
  const router = useRouter();
  const { address } = useAccount();
  const { contracts } = useNest();
  const { send, pending } = useTx();
  const [name, setName] = useState("Green Meadows Residency");
  const [city, setCity] = useState("Bengaluru");
  const [lat, setLat] = useState(12.9416);
  const [lng, setLng] = useState(77.5661);
  const [committee, setCommittee] = useState<string[]>(() => [address ?? "", "", "", "", ""]);
  const [threshold, setThreshold] = useState(3);
  const [tier1, setTier1] = useState(10000);
  const [tier2, setTier2] = useState(50000);
  const [quorum, setQuorum] = useState(30);
  const [preset, setPreset] = useState<WindowPreset>("demo");
  const [error, setError] = useState<string | null>(null);

  const members = committee.map((c) => c.trim()).filter(Boolean);
  const problems = [
    members.some((m) => !isAddress(m)) && "Every committee entry must be a wallet address.",
    new Set(members.map((m) => m.toLowerCase())).size !== members.length && "Committee members must be different wallets.",
    (members.length < 1 || members.length > 5) && "The committee has 1–5 members.",
    (threshold < 1 || threshold > members.length) && "The approval threshold must be between 1 and the committee size.",
    !(tier1 < tier2) && "The tier-1 limit must be below the tier-2 limit.",
    (quorum < 0 || quorum > 100) && "Quorum is 0–100%.",
    !name.trim() && "Give the society a name.",
  ].filter(Boolean) as string[];

  const submit = async () => {
    setError(null);
    try {
      const meta: SocietyMeta = {
        schema: "nestledger.society.v1", createdAt: new Date().toISOString(), displayName: name.trim(), city: city.trim(), location: { lat, lng },
      };
      const { hash: metaHash } = await postManifest(meta);
      const w = WINDOWS[preset];
      const cfg = {
        threshold, tier1Limit: inrToWei(tier1), tier2Limit: inrToWei(tier2), quorumBps: Math.round(quorum * 100),
        votingPeriod: w.votingPeriod, attestTimeout: w.attestTimeout,
      };
      const { receipt } = await send({
        address: contracts.ledger.address!, abi: contracts.ledger.abi, functionName: "createSociety", args: [name.trim(), metaHash, members, cfg],
      }, "Create society");
      const created = receipt.logs
        .map((log) => { try { return decodeEventLog({ abi: societyLedgerAbi, data: log.data, topics: log.topics }); } catch { return null; } })
        .find((e) => e?.eventName === "SocietyCreated");
      router.push(created && "societyId" in created.args ? `/society/${created.args.societyId}` : "/dashboard");
    } catch (e) {
      setError(describeError(e));
    }
  };

  return (
    <div className="card space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm"><span className="text-slate-700">Society name (public, on-chain)</span>
          <input className={input} value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="block text-sm"><span className="text-slate-700">City</span>
          <input className={input} value={city} onChange={(e) => setCity(e.target.value)} /></label>
        <label className="block text-sm"><span className="text-slate-700">Latitude (for the photo geofence)</span>
          <input type="number" step="0.0001" className={input} value={lat} onChange={(e) => setLat(Number(e.target.value))} /></label>
        <label className="block text-sm"><span className="text-slate-700">Longitude</span>
          <input type="number" step="0.0001" className={input} value={lng} onChange={(e) => setLng(Number(e.target.value))} /></label>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm text-slate-700">Committee (up to 5 wallets)</legend>
        {committee.map((c, i) => (
          <input key={i} className="w-full rounded-md border border-slate-300 px-3 py-1.5 font-mono text-sm" placeholder={i === 0 ? "0x… (you)" : "0x…"}
            value={c} onChange={(e) => setCommittee(committee.map((x, j) => (j === i ? e.target.value.trim() : x)))} />
        ))}
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm"><span className="text-slate-700">Approvals needed for tier 1 and 2</span>
          <input type="number" min={1} max={5} className={input} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} /></label>
        <label className="block text-sm"><span className="text-slate-700">Resident vote quorum (% of flat weight)</span>
          <input type="number" min={0} max={100} className={input} value={quorum} onChange={(e) => setQuorum(Number(e.target.value))} /></label>
        <label className="block text-sm"><span className="text-slate-700">Tier 0 up to (₹, one approval)</span>
          <input type="number" min={1} className={input} value={tier1} onChange={(e) => setTier1(Number(e.target.value))} /></label>
        <label className="block text-sm"><span className="text-slate-700">Tier 1 up to (₹; above this residents also vote)</span>
          <input type="number" min={1} className={input} value={tier2} onChange={(e) => setTier2(Number(e.target.value))} /></label>
        <label className="block text-sm sm:col-span-2"><span className="text-slate-700">Timing</span>
          <select className={input} value={preset} onChange={(e) => setPreset(e.target.value as WindowPreset)}>
            <option value="demo">Demo speed (2-minute resident votes, AI check waits 60 s)</option>
            <option value="production">Real world (7-day votes, AI check waits 24 h)</option>
          </select></label>
      </div>
      <p className="text-xs text-slate-500">
        Tiers use each vendor&apos;s spend so far this month including the new bill, so one large bill can&apos;t be split into small ones.
        An AI flag raises a bill by one tier and resets its approvals; every approver must then give a written reason.
      </p>
      {problems.map((p) => <Notice key={p} tone="warn">{p}</Notice>)}
      {error && <p className="text-sm text-red-700">{error}</p>}
      <button className="btn-primary w-full" disabled={pending || problems.length > 0} onClick={submit}>Create society</button>
      <p className="text-xs text-slate-500">You become the society admin and add flats on the next page.</p>
    </div>
  );
}
