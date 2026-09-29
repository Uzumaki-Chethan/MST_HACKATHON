"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { decodeEventLog, isAddress } from "viem";
import { useAccount, useReadContract } from "wagmi";
import { inrToWei, rentalEscrowAbi, weiToInr, WINDOWS, type WindowPreset } from "@nestledger/shared";
import type { LeaseTerms } from "@nestledger/shared/schemas";
import { Amount } from "@/components/Amount";
import { Notice, RequireDeployed, RequireWallet } from "@/components/Gates";
import { useNest } from "@/hooks/useNest";
import { useTx } from "@/hooks/useTx";
import { getMyFlats, postManifest } from "@/lib/api";
import { LandlordRoleNote, useCanOfferLease } from "@/hooks/useCanOfferLease";
import { describeError } from "@/lib/labels";

const TIERS = ["Tier 0", "Tier 1", "Tier 2 (pays 75%)", "Tier 3 (pays 50%)"];
const input = "mt-1 w-full rounded-md border border-slate-300 px-3 py-2";

export default function NewLeasePage() {
  const { contracts } = useNest();
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">Offer a lease</h1>
      <RequireWallet signedIn>
        <RequireDeployed address={contracts.rental.address} name="RentalEscrow">
          <OfferGate />
        </RequireDeployed>
      </RequireWallet>
    </div>
  );
}

function OfferGate() {
  const canOffer = useCanOfferLease();
  if (canOffer === undefined) return <p className="text-sm text-slate-500">Checking your profile…</p>;
  if (!canOffer) return <Notice><LandlordRoleNote /></Notice>;
  return <OfferForm />;
}

function OfferForm() {
  const router = useRouter();
  const { address } = useAccount();
  const { contracts } = useNest();
  const { send, pending } = useTx();

  const [tenant, setTenant] = useState("");
  const [flatId, setFlatId] = useState("0");
  const [rentINR, setRentINR] = useState(30000);
  const [months, setMonths] = useState(6);
  const [trust, setTrust] = useState(true);
  const [preset, setPreset] = useState<WindowPreset>("demo");
  const [periods, setPeriods] = useState<number>(WINDOWS.demo.periods);
  const [terms, setTerms] = useState("");
  const [error, setError] = useState<string | null>(null);

  const flats = useQuery({ queryKey: ["myFlats", address], queryFn: getMyFlats, retry: false });
  const flat = flats.data?.find((f) => f.flatId === flatId);
  const tenantOk = isAddress(tenant) && tenant.toLowerCase() !== address?.toLowerCase();
  const rentWei = inrToWei(rentINR);

  const { rental, passport, registry } = contracts;
  const tenantRegistered = useReadContract({
    address: registry.address!, abi: registry.abi, functionName: "isRegistered", args: [tenant as `0x${string}`],
    query: { enabled: tenantOk && !!registry.address },
  });
  const tier = useReadContract({
    address: passport.address!, abi: passport.abi, functionName: "tenantTier", args: [tenant as `0x${string}`],
    query: { enabled: tenantOk && !!passport.address },
  });
  const required = useReadContract({
    address: rental.address!, abi: rental.abi, functionName: "requiredDeposit", args: [tenant as `0x${string}`, rentWei, months],
    query: { enabled: tenantOk && trust },
  });
  const depositWei = trust ? (required.data as bigint | undefined) : rentWei * BigInt(months);
  const w = WINDOWS[preset];

  const submit = async () => {
    if (!rental.address || !depositWei) return;
    setError(null);
    try {
      const manifest: LeaseTerms = {
        schema: "nestledger.lease-terms.v1",
        createdAt: new Date().toISOString(),
        ...(flat ? { flatLabel: flat.label, societyId: flat.societyId } : {}),
        rentINR,
        maintenanceINR: flat ? weiToInr(BigInt(flat.maintenanceWei)) : 0,
        depositINR: weiToInr(depositWei),
        depositMonths: months,
        periodDays: w.period / 86400,
        periods,
        graceDays: w.grace / 86400,
        ...(terms.trim() ? { houseRules: terms.split("\n").map((s) => s.trim()).filter(Boolean) } : {}),
        inspectionTemplate: preset === "demo" ? "compact" : "full",
      };
      const { hash: termsHash } = await postManifest(manifest);
      const t = {
        tenant: tenant as `0x${string}`,
        flatId: BigInt(flatId),
        rent: rentWei,
        deposit: rentWei * BigInt(months),
        useTrustPricing: trust,
        baseDepositMonths: months,
        period: w.period,
        periods,
        grace: w.grace,
        baselineWindow: w.baselineWindow,
        claimWindow: w.claimWindow,
        responseWindow: w.responseWindowLease,
        termsHash,
      };
      const { receipt } = await send({ address: rental.address, abi: rental.abi, functionName: "offerLease", args: [t] }, "Offer lease");
      const offered = receipt.logs
        .map((log) => { try { return decodeEventLog({ abi: rentalEscrowAbi, data: log.data, topics: log.topics }); } catch { return null; } })
        .find((e) => e?.eventName === "LeaseOffered");
      const leaseId = offered && "leaseId" in offered.args ? String(offered.args.leaseId) : null;
      router.push(leaseId ? `/rent/${leaseId}` : "/dashboard");
    } catch (e) {
      setError(describeError(e));
    }
  };

  return (
    <div className="card space-y-4">
      <label className="block text-sm">
        <span className="text-slate-700">Tenant wallet address</span>
        <input className={`${input} font-mono`} placeholder="0x…" value={tenant} onChange={(e) => setTenant(e.target.value.trim())} />
        <span className="text-xs text-slate-500">Paste it from the tenant&apos;s /passport page.</span>
      </label>
      {tenantOk && tenantRegistered.data === false && <Notice tone="warn">This address has no NestLedger profile. The tenant must onboard first.</Notice>}
      {tenantOk && tier.data !== undefined && <p className="text-sm text-slate-600">Tenant passport: {TIERS[Number(tier.data)]}</p>}

      <label className="block text-sm">
        <span className="text-slate-700">Flat</span>
        <select className={input} value={flatId} onChange={(e) => setFlatId(e.target.value)}>
          <option value="0">Not in a registered society</option>
          {flats.data?.map((f) => <option key={f.flatId} value={f.flatId}>{f.label} (society #{f.societyId})</option>)}
        </select>
        {flat && <span className="text-xs text-slate-500">Maintenance is added to each rent payment and goes straight to the society: <Amount wei={flat.maintenanceWei} inline /></span>}
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="text-slate-700">Monthly rent (₹)</span>
          <input type="number" min={1} className={input} value={rentINR} onChange={(e) => setRentINR(Number(e.target.value))} />
          <Amount wei={rentWei} />
        </label>
        <label className="block text-sm">
          <span className="text-slate-700">Deposit (months of rent)</span>
          <input type="number" min={1} max={12} className={input} value={months} onChange={(e) => setMonths(Number(e.target.value))} />
        </label>
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={trust} onChange={(e) => setTrust(e.target.checked)} />
        <span>
          <span className="font-medium">Trust pricing</span>: the deposit shrinks with the tenant&apos;s NestPassport tier (Tier 2 pays 75%, Tier 3 pays 50%).
        </span>
      </label>
      <p className="text-sm">
        Deposit the tenant locks: {depositWei !== undefined ? <Amount wei={depositWei} inline /> : <span className="text-slate-500">enter the tenant address</span>}
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="text-slate-700">Timing</span>
          <select className={input} value={preset} onChange={(e) => { const p = e.target.value as WindowPreset; setPreset(p); setPeriods(WINDOWS[p].periods); }}>
            <option value="demo">Demo speed (periods of 90 s)</option>
            <option value="production">Real world (30-day periods)</option>
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-slate-700">Number of rent periods</span>
          <input type="number" min={1} className={input} value={periods} onChange={(e) => setPeriods(Number(e.target.value))} />
        </label>
      </div>

      <label className="block text-sm">
        <span className="text-slate-700">House rules / terms (optional, one per line; stays off-chain, only its hash goes on-chain)</span>
        <textarea className={input} rows={3} value={terms} onChange={(e) => setTerms(e.target.value)} />
      </label>

      {error && <p className="text-sm text-red-700">{error}</p>}
      <button className="btn-primary w-full" disabled={pending || !tenantOk || !depositWei || tenantRegistered.data === false || rentINR <= 0} onClick={submit}>
        {pending ? "Waiting for BridgeKey…" : "Offer lease"}
      </button>
    </div>
  );
}
