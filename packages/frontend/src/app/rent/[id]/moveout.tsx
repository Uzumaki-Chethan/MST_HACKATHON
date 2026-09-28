"use client";

// Lease page, move-out half (SPEC §2.2 steps 5–12, §8.3 action panel).
import { useMemo, useState } from "react";
import Link from "next/link";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useAccount, useReadContract } from "wagmi";
import { inrToWei, weiToInr, ZERO_HASH } from "@nestledger/shared";
import type { AttestationReport, LeaseTerms, MoveOutReport, RentalClaim } from "@nestledger/shared/schemas";
import { Amount } from "@/components/Amount";
import { SimulatedBadge } from "@/components/Badges";
import { CaptureWizard } from "@/components/CaptureWizard";
import { Countdown } from "@/components/Countdown";
import { BeforeAfter, photoByVantage, useBeforeAfter, useBundle, useReport } from "@/components/Evidence";
import { Notice } from "@/components/Gates";
import { AddressLink } from "@/components/TxLink";
import { useNest } from "@/hooks/useNest";
import { useTx } from "@/hooks/useTx";
import { aiMoveOut, fetchEvidenceObjectUrl, getManifest, postManifest } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { describeError } from "@/lib/labels";
import { bit, type Attestation, type Claim, type Lease, type Tranche } from "@/lib/lease";

const now = () => Math.floor(Date.now() / 1000);
const CHANGE_TEXT: Record<string, string> = {
  new_damage: "New damage", missing_item: "Missing item", cleaning_required: "Cleaning needed",
  normal_wear: "Normal wear (never deductible)", cannot_compare: "Couldn't compare", none: "No change",
};

function useTerms(termsHash: `0x${string}`) {
  const { session } = useAuth();
  return useQuery({
    queryKey: ["manifest", termsHash],
    queryFn: () => getManifest<LeaseTerms>(termsHash),
    enabled: !!session && termsHash !== ZERO_HASH,
    retry: false,
  });
}

/** The move-out report for the lease's on-chain move-out bundle (the backend returns the stored one). */
export function useMoveOutReport(id: string, l: Lease) {
  const { session } = useAuth();
  return useQuery({
    queryKey: ["moveOutReport", id, l.moveOutEvidence],
    queryFn: () => aiMoveOut(id, l.moveOutEvidence),
    enabled: !!session && l.moveOutEvidence !== ZERO_HASH,
    staleTime: Infinity,
    retry: false,
  });
}

// ---------------------------------------------------------------- start move-out

export function StartMoveOut({ id, l }: { id: string; l: Lease }) {
  const { contracts } = useNest();
  const { send, pending } = useTx();
  const terms = useTerms(l.termsHash);
  const baseline = useBundle(l.baselineEvidence);
  const photos = [...photoByVantage(baseline.data).entries()];
  const ghosts = useQueries({
    queries: photos.map(([, hash]) => ({ queryKey: ["evidence-url", hash], queryFn: () => fetchEvidenceObjectUrl(hash), staleTime: Infinity })),
  });
  const ghostMap = Object.fromEntries(photos.map(([v], i) => [v, ghosts[i]?.data]).filter(([, u]) => u)) as Record<string, string>;

  const [open, setOpen] = useState(false);
  const [bundleHash, setBundleHash] = useState<`0x${string}` | null>(null);
  const [report, setReport] = useState<MoveOutReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analyse = async (hash: `0x${string}`) => {
    setBundleHash(hash);
    setBusy(true);
    setError(null);
    try {
      setReport((await aiMoveOut(id, hash)).report);
    } catch (e) {
      setError(`${describeError(e)} You can still start move-out; the landlord's claim will then have no AI backing.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card space-y-3">
      <h2 className="font-semibold text-slate-900">Move out</h2>
      <p className="text-sm text-slate-600">
        Photograph the same angles as at move-in; the move-in photo is shown as a faint ghost so you can line them up.
        The AI then compares each pair. Normal wear and tear is never deductible.
      </p>
      {!open && <button className="btn-primary" onClick={() => setOpen(true)}>Start the move-out walkthrough</button>}
      {open && !bundleHash && (
        <CaptureWizard context={{ type: "lease", id, stage: "move-out" }} template={terms.data?.inspectionTemplate ?? "compact"} ghosts={ghostMap} onDone={(h) => analyse(h)} />
      )}
      {busy && <p className="text-sm text-slate-600">The AI is comparing move-in and move-out photos…</p>}
      {error && <p className="text-sm text-red-700">{error}</p>}
      {report && <FindingsList report={report} />}
      {bundleHash && !busy && (
        <button className="btn-primary w-full" disabled={pending}
          onClick={() => send({ address: contracts.rental.address!, abi: contracts.rental.abi, functionName: "startMoveOut", args: [BigInt(id), bundleHash] }, "Start move-out").catch(() => undefined)}>
          Start move-out on-chain (opens the landlord&apos;s claim window)
        </button>
      )}
    </section>
  );
}

function FindingsList({ report }: { report: MoveOutReport }) {
  const shown = report.findings.filter((f) => f.change !== "none");
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <SimulatedBadge what={report.model === "fixtures" ? "AI: fixture mode" : "AI agent"} />
        <span className="text-sm text-slate-600">{report.summary}</span>
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-slate-600">No changes found.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {shown.map((f) => (
            <li key={f.findingId}>
              <span className="font-medium">{CHANGE_TEXT[f.change]}</span> · {f.description}{" "}
              {f.deductible ? <span className="text-slate-600">(est. ₹{f.estimatedCostINR.toLocaleString("en-IN")}, sample rate)</span> : <span className="text-slate-500">(₹0)</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- landlord claim

type Row = { key: string; findingId?: string; description: string; type: RentalClaim["items"][number]["type"]; inr: number; aiINR: number; on: boolean };

const typeOf = (change: string): Row["type"] =>
  change === "new_damage" ? "damage" : change === "missing_item" ? "missing_item" : change === "cleaning_required" ? "cleaning" : "other";

export function ClaimWindow({ id, l, t, me }: { id: string; l: Lease; t: Tranche; me: "tenant" | "landlord" | null }) {
  const { contracts } = useNest();
  const { send, pending } = useTx();
  const deadline = Number(t.claimDeadline);
  const rental = contracts.rental;

  const expired = (
    <p className="text-sm text-slate-700">
      If the landlord doesn&apos;t claim, the full deposit goes back to the tenant in{" "}
      <Countdown until={deadline}>
        <button className="btn-secondary" disabled={pending}
          onClick={() => send({ address: rental.address!, abi: rental.abi, functionName: "finalizeNoClaim", args: [BigInt(id)] }, "Refund deposit (no claim)").catch(() => undefined)}>
          Refund the tenant now
        </button>
      </Countdown>
    </p>
  );
  if (me !== "landlord" || now() > deadline) return <section className="card space-y-2">{expired}</section>;
  return (
    <section className="card space-y-3">
      <h2 className="font-semibold text-slate-900">Claim deductions or release the deposit</h2>
      {expired}
      <ClaimBuilder id={id} l={l} t={t} />
    </section>
  );
}

function ClaimBuilder({ id, l, t }: { id: string; l: Lease; t: Tranche }) {
  const { contracts } = useNest();
  const { send, pending } = useTx();
  const report = useMoveOutReport(id, l);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rental = contracts.rental;

  const initial = useMemo<Row[]>(() => (report.data?.report.findings ?? [])
    .filter((f) => f.change !== "none")
    .map((f) => ({
      key: f.findingId, findingId: f.findingId, description: `${f.room}: ${f.description}`, type: typeOf(f.change),
      inr: f.estimatedCostINR, aiINR: f.estimatedCostINR, on: f.deductible,
    })), [report.data]);
  const items = rows ?? initial;
  const set = (key: string, patch: Partial<Row>) => setRows(items.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const chosen = items.filter((r) => r.on && r.inr > 0);
  const unpaid = l.unpaidDues;
  const totalWei = unpaid + chosen.reduce((s, r) => s + inrToWei(r.inr), BigInt(0));
  const tooMany = chosen.length + 1 > 10;
  const tooMuch = totalWei > t.amount;

  const submit = async () => {
    setError(null);
    try {
      if (!report.data) throw new Error("The move-out report isn't available, so there is nothing to reference.");
      const claim: RentalClaim = {
        schema: "nestledger.claim.rental.v1",
        createdAt: new Date().toISOString(),
        leaseId: id,
        moveOutReportHash: report.data.reportHash,
        items: [
          { index: 0, type: "unpaid_dues", description: "Unpaid rent", amountWei: unpaid.toString(), amountINR: weiToInr(unpaid) },
          ...chosen.map((r, i) => ({
            index: i + 1, type: r.type, description: r.description, amountWei: inrToWei(r.inr).toString(), amountINR: r.inr,
            ...(r.findingId ? { findingId: r.findingId } : {}),
          })),
        ],
      };
      const { hash } = await postManifest(claim);
      await send({ address: rental.address!, abi: rental.abi, functionName: "submitClaim", args: [BigInt(id), claim.items.map((it) => BigInt(it.amountWei)), hash] }, "Submit claim");
    } catch (e) {
      setError(describeError(e));
    }
  };

  return (
    <div className="space-y-3">
      {report.isLoading && <p className="text-sm text-slate-500">Loading the AI move-out findings…</p>}
      {report.isError && <Notice tone="warn">The AI move-out report isn&apos;t available. Items you add won&apos;t be AI-backed.</Notice>}
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase text-slate-500"><th className="py-1">Claim</th><th>Item</th><th className="text-right">₹</th></tr>
        </thead>
        <tbody>
          <tr className="border-t border-slate-100">
            <td className="py-2">✓</td>
            <td>Unpaid rent <span className="text-xs text-slate-500">(from the contract&apos;s own records; always backed)</span></td>
            <td className="text-right"><Amount wei={unpaid} inline /></td>
          </tr>
          {items.map((r) => (
            <tr key={r.key} className="border-t border-slate-100 align-top">
              <td className="py-2"><input type="checkbox" checked={r.on} onChange={(e) => set(r.key, { on: e.target.checked })} /></td>
              <td>
                {r.findingId ? r.description : (
                  <input className="w-full rounded border border-slate-300 px-2 py-1" value={r.description} placeholder="Describe the deduction" onChange={(e) => set(r.key, { description: e.target.value })} />
                )}
                {r.on && r.inr > r.aiINR && (
                  <p className="text-xs text-red-700">
                    Not AI-backed{r.findingId ? ` above ₹${r.aiINR.toLocaleString("en-IN")}` : ""}: it goes to arbiters if the tenant stays silent.
                  </p>
                )}
              </td>
              <td className="text-right">
                <input type="number" min={0} className="w-28 rounded border border-slate-300 px-2 py-1 text-right" value={r.inr} onChange={(e) => set(r.key, { inr: Number(e.target.value) })} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="btn-secondary" disabled={items.length + 1 >= 10}
        onClick={() => setRows([...items, { key: `extra-${items.length}`, description: "", type: "other", inr: 0, aiINR: 0, on: true }])}>
        Add another item
      </button>
      <p className="text-sm">
        Total claimed: <Amount wei={totalWei} inline /> of the <Amount wei={t.amount} inline /> deposit. The rest goes back to the tenant.
      </p>
      {tooMany && <p className="text-sm text-red-700">At most 10 items per claim (including unpaid rent).</p>}
      {tooMuch && <p className="text-sm text-red-700">The claim can&apos;t exceed the deposit.</p>}
      {error && <p className="text-sm text-red-700">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button className="btn-primary" disabled={pending || tooMany || tooMuch || totalWei === BigInt(0)} onClick={submit}>Submit claim</button>
        <button className="btn-secondary" disabled={pending}
          onClick={() => send({ address: rental.address!, abi: rental.abi, functionName: "releaseDepositInFull", args: [BigInt(id)] }, "Release full deposit").catch(() => undefined)}>
          Release full deposit
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- claim review / tenant response

export function useClaimState(id: string) {
  const { contracts } = useNest();
  const r = contracts.rental;
  const q = { refetchInterval: 4000 };
  const claim = useReadContract({ address: r.address!, abi: r.abi, functionName: "getClaim", args: [BigInt(id), 0], query: q });
  const att = useReadContract({ address: r.address!, abi: r.abi, functionName: "getAttestation", args: [BigInt(id), 0], query: q });
  const agreement = useReadContract({ address: r.address!, abi: r.abi, functionName: "getAgreement", args: [BigInt(id)], query: q });
  const backed = useReadContract({ address: r.address!, abi: r.abi, functionName: "backedMask", args: [BigInt(id)], query: q });
  return {
    claim: claim.data as unknown as Claim | undefined,
    att: att.data as unknown as Attestation | undefined,
    responseWindow: agreement.data ? Number((agreement.data as unknown as { responseWindow: number }).responseWindow) : undefined,
    backedMask: backed.data !== undefined ? Number(backed.data) : undefined,
  };
}

export function ClaimReview({ id, t, me }: { id: string; t: Tranche; me: "tenant" | "landlord" | null }) {
  const { contracts } = useNest();
  const { send, pending } = useTx();
  const { claim, att, responseWindow, backedMask } = useClaimState(id);
  const { session } = useAuth();
  const manifest = useQuery({
    queryKey: ["manifest", claim?.evidenceHash],
    queryFn: () => getManifest<RentalClaim>(claim!.evidenceHash),
    enabled: !!session && !!claim, retry: false,
  });
  const moveOut = useReport<MoveOutReport>(manifest.data?.moveOutReportHash);
  const attested = !!att && att.attestedAt > BigInt(0);
  const wrapper = useReport<AttestationReport>(attested ? att!.reportHash : null);
  const photos = useBeforeAfter(moveOut.data);
  const bond = useReadContract({ address: contracts.resolver.address!, abi: contracts.resolver.abi, functionName: "disputeBond", query: { enabled: !!contracts.resolver.address } });
  const [mask, setMask] = useState(0);

  if (!claim || responseWindow === undefined) return <p className="text-sm text-slate-500">Loading the claim…</p>;
  const claimed = t.status === 2;
  const deadline = Number(claim.submittedAt) + responseWindow;
  const rental = contracts.rental;
  const findings = new Map((moveOut.data?.findings ?? []).map((f) => [f.findingId, f]));
  const canRespond = me === "tenant" && claimed && now() <= deadline;

  return (
    <section className="card space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold text-slate-900">The landlord&apos;s claim</h2>
        {attested ? <SimulatedBadge what={moveOut.data?.model === "fixtures" ? "AI: fixture mode" : "AI agent"} /> : <span className="text-xs text-slate-500">Waiting for the AI agent&apos;s attestation…</span>}
        {attested && <span className="text-xs text-slate-500">AI score {att!.score}</span>}
      </div>

      <div className="space-y-3">
        {claim.items.map((amount, i) => {
          const item = manifest.data?.items.find((x) => x.index === i);
          const f = item?.findingId ? findings.get(item.findingId) : undefined;
          const supported = attested ? att!.supported[i] : undefined;
          const isBacked = backedMask !== undefined && bit(backedMask, i);
          const reason = wrapper.data?.mapping.find((m) => m.item === i)?.reason;
          if (amount === BigInt(0) && i === 0) return null;
          return (
            <div key={i} className={`rounded-md border p-3 ${bit(claim.disputedMask, i) ? "border-amber-300" : "border-slate-200"}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-slate-800">{i === 0 ? "Unpaid rent" : item?.description ?? `Item ${i}`}</p>
                  <p className="text-xs text-slate-600">
                    Claimed <Amount wei={amount} inline />
                    {supported !== undefined && i > 0 && <> · AI supports <Amount wei={supported} inline /></>}
                  </p>
                  {reason && <p className="text-xs text-slate-500">{reason}</p>}
                  <p className={`text-xs font-medium ${isBacked ? "text-accent-dark" : "text-red-700"}`}>
                    {isBacked ? "✓ Backed: paid to the landlord if you stay silent" : "✗ Not backed: goes to arbiters if you stay silent"}
                  </p>
                  {bit(claim.awardedMask, i) && <p className="text-xs text-slate-500">Paid out.</p>}
                  {bit(claim.disputedMask, i) && <p className="text-xs text-amber-700">Disputed, with the arbiters.</p>}
                </div>
                {canRespond && i > 0 && (
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={bit(mask, i)} onChange={(e) => setMask(e.target.checked ? mask | (1 << i) : mask & ~(1 << i))} />
                    Dispute
                  </label>
                )}
              </div>
              {f && <div className="mt-2"><BeforeAfter before={photos.before.get(f.vantageId)} after={photos.after.get(f.vantageId)} label={f.description} /></div>}
            </div>
          );
        })}
      </div>

      {claimed && (
        <p className="text-sm text-slate-700">
          {me === "tenant" ? "Respond" : "The tenant responds"} within{" "}
          <Countdown until={deadline}>
            <button className="btn-secondary" disabled={pending}
              onClick={() => send({ address: rental.address!, abi: rental.abi, functionName: "finalizeAfterSilence", args: [BigInt(id)] }, "Finalise after silence").catch(() => undefined)}>
              Finalise now
            </button>
          </Countdown>
          . If there is no response, backed items are paid and unbacked items go to three arbiters automatically.
        </p>
      )}

      {canRespond && (
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" disabled={pending}
            onClick={() => send({ address: rental.address!, abi: rental.abi, functionName: "respond", args: [BigInt(id), 0] }, "Accept claim").catch(() => undefined)}>
            Accept all
          </button>
          <button className="btn-secondary" disabled={pending || mask === 0 || bond.data === undefined}
            onClick={() => send({ address: rental.address!, abi: rental.abi, functionName: "respond", args: [BigInt(id), mask], value: bond.data as bigint }, "Dispute selected items").catch(() => undefined)}>
            Dispute selected{bond.data !== undefined && <> (bond <Amount wei={bond.data as bigint} inline />)</>}
          </button>
        </div>
      )}
      {canRespond && mask !== 0 && (
        <p className="text-xs text-slate-500">
          Undisputed items are paid to the landlord now and the unclaimed remainder comes back to you now. Only the disputed items stay frozen.
          The bond is returned if you win at least half of the disputed value.
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- dispute + closed

export function DisputeStatus({ id }: { id: string }) {
  const { contracts } = useNest();
  const res = contracts.resolver;
  const disputeId = useReadContract({
    address: res.address!, abi: res.abi, functionName: "disputeFor", args: [contracts.rental.address!, BigInt(id), 0],
    query: { enabled: !!res.address, refetchInterval: 4000 },
  });
  const d = useReadContract({
    address: res.address!, abi: res.abi, functionName: "getDispute", args: [disputeId.data as bigint],
    query: { enabled: !!disputeId.data, refetchInterval: 4000 },
  });
  if (!res.address) return <Notice>The DisputeResolver is not deployed yet.</Notice>;
  if (!d.data) return <p className="text-sm text-slate-500">Loading the dispute…</p>;
  const dispute = d.data as unknown as { mask: number; arbiters: readonly `0x${string}`[]; votes: readonly number[]; votedBits: number; voteDeadline: bigint; status: number; amounts: readonly bigint[] };
  const items = dispute.amounts.map((a, i) => ({ a, i })).filter(({ i }) => bit(dispute.mask, i));
  return (
    <section className="card space-y-3">
      <h2 className="font-semibold text-slate-900">With the arbiters (dispute #{String(disputeId.data)})</h2>
      <p className="text-sm text-slate-600">
        Three neutral arbiters vote on each disputed item. An item is decided as soon as two agree, and the contract pays out automatically.
      </p>
      <ul className="space-y-1 text-sm">
        {items.map(({ a, i }) => {
          let up = 0, down = 0;
          dispute.arbiters.forEach((_, s) => { if (bit(dispute.votedBits, s)) { if (bit(dispute.votes[s], i)) up++; else down++; } });
          return <li key={i}>Item {i} (<Amount wei={a} inline />): {up} uphold · {down} reject</li>;
        })}
      </ul>
      <p className="text-xs text-slate-500">
        Arbiters: {dispute.arbiters.map((x, s) => <span key={x} className="mr-2"><AddressLink address={x} />{bit(dispute.votedBits, s) ? " ✓" : ""}</span>)}
      </p>
      {dispute.status === 0 && <p className="text-xs text-slate-500">Voting closes in <Countdown until={dispute.voteDeadline} /> (after that the admin can replace a silent arbiter).</p>}
    </section>
  );
}

export function PaidSoFar({ t }: { t: Tranche }) {
  return (
    <p className="text-sm text-slate-700">
      Paid so far: <Amount wei={t.released} inline /> to the landlord, <Amount wei={t.refunded} inline /> back to the tenant.
    </p>
  );
}

export function ClosedSummary({ t, me }: { t: Tranche; me: "tenant" | "landlord" | null }) {
  const { address } = useAccount();
  const { contracts } = useNest();
  const { send, pending } = useTx();
  const owed = useReadContract({
    address: contracts.rental.address!, abi: contracts.rental.abi, functionName: "withdrawable", args: [address!],
    query: { enabled: !!address },
  });
  return (
    <section className="card space-y-3">
      <h2 className="font-semibold text-slate-900">Deposit settled</h2>
      <p className="text-sm text-slate-700">
        Landlord received <Amount wei={t.released} inline />; tenant got back <Amount wei={t.refunded} inline />.
      </p>
      {(owed.data as bigint | undefined) ? (
        <button className="btn-primary" disabled={pending}
          onClick={() => send({ address: contracts.rental.address!, abi: contracts.rental.abi, functionName: "withdraw", args: [] }, "Withdraw").catch(() => undefined)}>
          Withdraw <Amount wei={owed.data as bigint} inline /> held for you
        </button>
      ) : null}
      <div className="flex flex-wrap gap-3 text-sm">
        {address && <Link className="text-accent underline" href={`/passport/${address}`}>See your updated NestPassport</Link>}
        {me === "landlord" && <Link className="text-accent underline" href="/rent/new">Offer a new lease with trust pricing</Link>}
      </div>
    </section>
  );
}
