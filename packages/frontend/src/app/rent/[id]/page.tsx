"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount, useReadContract } from "wagmi";
import { BaselineStatus, LeaseStatus, ZERO_HASH } from "@nestledger/shared";
import type { LeaseTerms, MoveInReport } from "@nestledger/shared/schemas";
import { Amount } from "@/components/Amount";
import { StatusChip } from "@/components/Badges";
import { CaptureWizard } from "@/components/CaptureWizard";
import { Countdown } from "@/components/Countdown";
import { Notice, RequireDeployed } from "@/components/Gates";
import { MoveInReportView } from "@/components/MoveInReportView";
import { Timeline } from "@/components/Timeline";
import { AddressLink } from "@/components/TxLink";
import { useNest } from "@/hooks/useNest";
import { useTx } from "@/hooks/useTx";
import { aiMoveIn, getManifest, getReport } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { describeError } from "@/lib/labels";
import { nextStep, roleOf, type Lease, type Tranche } from "@/lib/lease";
import { ClaimReview, ClaimWindow, ClosedSummary, DisputeStatus, PaidSoFar, StartMoveOut, useClaimState } from "./moveout";

export default function LeasePage({ params }: { params: { id: string } }) {
  const { contracts } = useNest();
  return (
    <RequireDeployed address={contracts.rental.address} name="RentalEscrow">
      <LeaseDetail id={params.id} />
    </RequireDeployed>
  );
}

function useNow() {
  const [now] = useState(() => Math.floor(Date.now() / 1000));
  return now;
}

function LeaseDetail({ id }: { id: string }) {
  const { address } = useAccount();
  const { contracts } = useNest();
  const now = useNow();
  const lease = useReadContract({
    address: contracts.rental.address!, abi: contracts.rental.abi, functionName: "getLease", args: [BigInt(id)],
    query: { refetchInterval: 4000 },
  });
  const tranche = useReadContract({
    address: contracts.rental.address!, abi: contracts.rental.abi, functionName: "getTranche", args: [BigInt(id), 0],
    query: { refetchInterval: 4000 },
  });
  const claimState = useClaimState(id);
  if (lease.isError) return <Notice tone="error">Lease #{id} could not be loaded.</Notice>;
  if (!lease.data) return <p className="text-sm text-slate-500">Loading lease #{id}…</p>;
  const l = lease.data as unknown as Lease;
  if (l.landlord === "0x0000000000000000000000000000000000000000") return <Notice>There is no lease #{id}.</Notice>;

  const me = roleOf(l, address);
  const t = tranche.data as unknown as Tranche | undefined;
  const step = nextStep(l, now, t && {
    status: t.status,
    claimDeadline: Number(t.claimDeadline),
    respondBy: claimState.claim && claimState.responseWindow !== undefined ? Number(claimState.claim.submittedAt) + claimState.responseWindow : undefined,
  });

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold text-slate-900">Lease #{id}</h1>
          <StatusChip kind="lease" value={l.status} enumValues={LeaseStatus} />
          {LeaseStatus[l.status] !== "Offered" && <StatusChip kind="baseline" value={l.baseline} enumValues={BaselineStatus} />}
        </div>
        <div className="grid gap-3 text-sm sm:grid-cols-4">
          <Field label="Landlord"><AddressLink address={l.landlord} /></Field>
          <Field label="Tenant"><AddressLink address={l.tenant} /></Field>
          <Field label="Rent per period"><Amount wei={l.rent} /></Field>
          <Field label="Deposit in escrow"><Amount wei={l.deposit} /></Field>
          {l.flatId > BigInt(0) && <Field label="Maintenance per period"><Amount wei={l.maintenance} /></Field>}
          <Field label="Rent paid">{l.paidPeriods} of {l.periods} periods{l.latePeriods ? ` (${l.latePeriods} late)` : ""}</Field>
          {me && <Field label="You are">the {me}</Field>}
        </div>
      </header>

      <section className="card space-y-1">
        <p className="text-sm">
          <span className="font-medium">Next: </span>
          {step.who !== "nobody" && <span className="capitalize">{step.who === me ? "you" : `the ${step.who}`}. </span>}
          {step.text}
        </p>
        {step.deadline && (
          <p className="text-sm text-slate-600">
            Time left: <Countdown until={step.deadline} />
            {step.ifNot && <> · if not, {step.ifNot}.</>}
          </p>
        )}
      </section>

      <ActionPanel id={id} l={l} t={t} me={me} />

      <section className="card space-y-3">
        <h2 className="font-semibold text-slate-900">On-chain history</h2>
        <Timeline contract="rental" id={id} />
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <div className="text-slate-800">{children}</div>
    </div>
  );
}

function ActionPanel({ id, l, t, me }: { id: string; l: Lease; t?: Tranche; me: "tenant" | "landlord" | null }) {
  const status = LeaseStatus[l.status];
  const baseline = BaselineStatus[l.baseline];
  const now = Math.floor(Date.now() / 1000);

  if (status === "Offered") return <OfferedPanel id={id} l={l} me={me} />;
  if (status === "Cancelled") return <Notice>The offer was cancelled. No deposit was ever locked.</Notice>;
  if (status === "MovingOut" || status === "Closed") {
    if (!t) return <p className="text-sm text-slate-500">Loading the deposit…</p>;
    const tranche = ["Pending", "Open", "Claimed", "Disputed", "Settled", "Refunded"][t.status];
    return (
      <div className="space-y-4">
        {tranche === "Open" && <ClaimWindow id={id} l={l} t={t} me={me} />}
        {(tranche === "Claimed" || tranche === "Disputed") && <ClaimReview id={id} t={t} me={me} />}
        {tranche === "Disputed" && <><PaidSoFar t={t} /><DisputeStatus id={id} /></>}
        {(tranche === "Settled" || tranche === "Refunded") && <ClosedSummary t={t} me={me} />}
      </div>
    );
  }
  const termOver = l.paidPeriods >= l.periods || now >= Number(l.startedAt) + l.periods * l.period;
  return (
    <div className="space-y-4">
      {baseline === "None" && me && (me === "tenant" || now > Number(l.startedAt) + l.baselineWindow) && <DocumentMoveIn id={id} l={l} />}
      {baseline === "None" && me === "landlord" && now <= Number(l.startedAt) + l.baselineWindow && (
        <Notice>The tenant documents move-in first. If they haven&apos;t by the deadline above, you can document it yourself.</Notice>
      )}
      {baseline !== "None" && <BaselinePanel id={id} l={l} me={me} />}
      {me === "tenant" && l.paidPeriods < l.periods && <PayRentPanel id={id} l={l} />}
      {termOver && me && <StartMoveOut id={id} l={l} />}
    </div>
  );
}

function OfferedPanel({ id, l, me }: { id: string; l: Lease; me: "tenant" | "landlord" | null }) {
  const { contracts } = useNest();
  const { send, pending } = useTx();
  const { session } = useAuth();
  const terms = useQuery({
    queryKey: ["manifest", l.termsHash],
    queryFn: () => getManifest<LeaseTerms>(l.termsHash),
    enabled: !!session && l.termsHash !== ZERO_HASH,
    retry: false,
  });
  const rental = contracts.rental;
  if (me === "tenant") {
    return (
      <section className="card space-y-3">
        <h2 className="font-semibold text-slate-900">Review and sign</h2>
        {terms.data?.houseRules?.length ? (
          <ul className="list-inside list-disc text-sm text-slate-700">{terms.data.houseRules.map((r) => <li key={r}>{r}</li>)}</ul>
        ) : (
          !session && <p className="text-sm text-slate-500">Sign in to read the full terms.</p>
        )}
        <p className="text-sm text-slate-700">
          Signing sends the deposit (<Amount wei={l.deposit} inline />) into the RentalEscrow contract. The landlord cannot withdraw it.
          It is released only by the move-out rules, and refunded to you in full if the landlord makes no claim in time.
        </p>
        <button className="btn-primary w-full" disabled={pending}
          onClick={() => send({ address: rental.address!, abi: rental.abi, functionName: "signLease", args: [BigInt(id)], value: l.deposit }, "Sign lease and lock deposit").catch(() => undefined)}>
          Sign &amp; lock deposit
        </button>
      </section>
    );
  }
  if (me === "landlord") {
    return (
      <section className="card flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-700">Waiting for the tenant to sign. You can withdraw the offer until then.</p>
        <button className="btn-secondary" disabled={pending}
          onClick={() => send({ address: rental.address!, abi: rental.abi, functionName: "cancelOffer", args: [BigInt(id)] }, "Cancel offer").catch(() => undefined)}>
          Cancel offer
        </button>
      </section>
    );
  }
  return <Notice>Waiting for the tenant to sign.</Notice>;
}

function DocumentMoveIn({ id, l }: { id: string; l: Lease }) {
  const { contracts } = useNest();
  const { send, pending } = useTx();
  const [open, setOpen] = useState(false);
  const [bundleHash, setBundleHash] = useState<`0x${string}` | null>(null);
  const [ai, setAi] = useState<{ report: MoveInReport; reportHash: `0x${string}` } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const template = useTemplate(l.termsHash);

  const analyse = async (hash: `0x${string}`) => {
    setBundleHash(hash);
    setBusy(true);
    setError(null);
    try {
      setAi(await aiMoveIn(id, hash));
    } catch (e) {
      setError(`${describeError(e)} You can still submit the photos without an AI report.`);
    } finally {
      setBusy(false);
    }
  };

  const submit = () =>
    bundleHash &&
    send({
      address: contracts.rental.address!, abi: contracts.rental.abi, functionName: "submitBaseline",
      args: [BigInt(id), bundleHash, ai?.reportHash ?? ZERO_HASH],
    }, "Submit move-in report").catch(() => undefined);

  return (
    <section className="card space-y-3">
      <h2 className="font-semibold text-slate-900">Document move-in</h2>
      <p className="text-sm text-slate-600">
        Take live photos from each standard angle. The AI writes a neutral condition report; only its hash goes on-chain.
        Whoever documents first sets the baseline, and the other side gets a fixed window to contest it.
      </p>
      {!open && <button className="btn-primary" onClick={() => setOpen(true)}>Start the photo walkthrough</button>}
      {open && !bundleHash && (
        <CaptureWizard context={{ type: "lease", id, stage: "move-in" }} template={template} onDone={(h) => analyse(h)} />
      )}
      {busy && <p className="text-sm text-slate-600">The AI is reading your photos…</p>}
      {error && <p className="text-sm text-red-700">{error}</p>}
      {ai && <MoveInReportView report={ai.report} />}
      {bundleHash && !busy && (
        <button className="btn-primary w-full" disabled={pending} onClick={submit}>Submit move-in report on-chain</button>
      )}
    </section>
  );
}

function useTemplate(termsHash: `0x${string}`): "full" | "compact" {
  const { session } = useAuth();
  const terms = useQuery({
    queryKey: ["manifest", termsHash],
    queryFn: () => getManifest<LeaseTerms>(termsHash),
    enabled: !!session && termsHash !== ZERO_HASH,
    retry: false,
  });
  return terms.data?.inspectionTemplate ?? "compact";
}

function BaselinePanel({ id, l, me }: { id: string; l: Lease; me: "tenant" | "landlord" | null }) {
  const { contracts } = useNest();
  const { send, pending } = useTx();
  const { session } = useAuth();
  const [contesting, setContesting] = useState(false);
  const template = useTemplate(l.termsHash);
  const report = useQuery({
    queryKey: ["report", l.baselineReport],
    queryFn: () => getReport<MoveInReport>(l.baselineReport),
    enabled: !!session && l.baselineReport !== ZERO_HASH,
    retry: false,
  });
  const baseline = BaselineStatus[l.baseline];
  const deadline = Number(l.baselineAt) + l.baselineWindow;
  const submitter = l.baselineBy.toLowerCase() === l.tenant.toLowerCase() ? "tenant" : "landlord";
  const isCounterparty = !!me && me !== submitter;
  const rental = contracts.rental;
  const call = (functionName: string, args: readonly unknown[], label: string) =>
    send({ address: rental.address!, abi: rental.abi, functionName, args }, label).catch(() => undefined);

  return (
    <section className="card space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold text-slate-900">Move-in report</h2>
        <span className="text-xs text-slate-500">documented by the {submitter}</span>
      </div>
      {report.data ? (
        <MoveInReportView report={report.data} />
      ) : l.baselineReport === ZERO_HASH ? (
        <p className="text-sm text-slate-500">Submitted without an AI report (photos only).</p>
      ) : (
        <p className="text-sm text-slate-500">{session ? "Loading the report…" : "Sign in to view the report and photos."}</p>
      )}

      {baseline === "Submitted" && (
        <div className="space-y-3 border-t border-slate-100 pt-3">
          <p className="text-sm text-slate-700">
            {isCounterparty ? "Do you agree with this report? " : `Waiting for the ${submitter === "tenant" ? "landlord" : "tenant"} to confirm or contest. `}
            If nobody responds, it is accepted as submitted in <Countdown until={deadline}>
              <button className="btn-secondary" disabled={pending} onClick={() => call("finalizeBaseline", [BigInt(id)], "Finalise move-in report")}>
                Finalise now
              </button>
            </Countdown>
          </p>
          {isCounterparty && Math.floor(Date.now() / 1000) <= deadline && !contesting && (
            <div className="flex flex-wrap gap-2">
              <button className="btn-primary" disabled={pending} onClick={() => call("confirmBaseline", [BigInt(id)], "Confirm move-in report")}>Confirm</button>
              <button className="btn-secondary" onClick={() => setContesting(true)}>Contest with my own photos</button>
            </div>
          )}
          {contesting && (
            <CaptureWizard
              context={{ type: "lease", id, stage: "baseline-counter" }}
              template={template}
              onDone={(hash) => call("contestBaseline", [BigInt(id), hash], "Contest move-in report")}
            />
          )}
        </div>
      )}
      {baseline === "Contested" && <p className="text-sm text-slate-600">Contested: the landlord&apos;s counter-photos are on record. At move-out the AI weighs both, and caps its confidence.</p>}
    </section>
  );
}

function PayRentPanel({ id, l }: { id: string; l: Lease }) {
  const { contracts } = useNest();
  const { send, pending } = useTx();
  const rental = contracts.rental;
  const due = useReadContract({
    address: rental.address!, abi: rental.abi, functionName: "rentDueInfo", args: [BigInt(id)],
    query: { refetchInterval: 4000 },
  });
  const [nextPeriod, dueAt, amount, overdue] = (due.data ?? []) as unknown as [number, bigint, bigint, boolean];
  const total = amount ?? l.rent + l.maintenance;
  const lateAt = dueAt !== undefined ? Number(dueAt) + l.grace : undefined;

  return (
    <section className="card space-y-3">
      <h2 className="font-semibold text-slate-900">Pay rent</h2>
      <p className="text-sm text-slate-700">
        Period {(nextPeriod ?? l.paidPeriods) + 1} of {l.periods}.{" "}
        {lateAt !== undefined && (overdue
          ? <span className="font-medium text-red-700">Paying now is recorded as late on your passport.</span>
          : <>On time if paid within <Countdown until={lateAt} />.</>)}
      </p>
      <ul className="text-sm text-slate-700">
        <li>Rent → landlord: <Amount wei={l.rent} inline /></li>
        {l.maintenance > BigInt(0) && <li>Maintenance → society treasury: <Amount wei={l.maintenance} inline /></li>}
      </ul>
      <button className="btn-primary w-full" disabled={pending}
        onClick={() => send({ address: rental.address!, abi: rental.abi, functionName: "payRent", args: [BigInt(id)], value: total }, "Pay rent").catch(() => undefined)}>
        Pay <Amount wei={total} inline />
      </button>
    </section>
  );
}
