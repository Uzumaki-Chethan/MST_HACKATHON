"use client";

import Link from "next/link";
import { useAccount, useReadContract } from "wagmi";
import { LeaseStatus } from "@nestledger/shared";
import { StatusChip } from "@/components/Badges";
import { Countdown } from "@/components/Countdown";
import { Notice, RequireWallet } from "@/components/Gates";
import { useNest } from "@/hooks/useNest";
import { nextStep, roleOf, type LeaseView } from "@/lib/lease";

const TIERS = ["Tier 0 (unverified)", "Tier 1 (verified)", "Tier 2 (25% smaller deposits)", "Tier 3 (50% smaller deposits)"];

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Your dashboard</h1>
      <RequireWallet>
        <Dashboard />
      </RequireWallet>
    </div>
  );
}

function useIds(c: { address?: `0x${string}`; abi: readonly unknown[] }, functionName: string, arg?: `0x${string}`) {
  return useReadContract({
    address: c.address!, abi: c.abi as never, functionName: functionName as never, args: [arg!] as never,
    query: { enabled: !!c.address && !!arg, refetchInterval: 8000 },
  }) as { data?: readonly bigint[]; isLoading: boolean };
}

function Dashboard() {
  const { address } = useAccount();
  const { contracts } = useNest();
  const registered = useReadContract({
    address: contracts.registry.address!, abi: contracts.registry.abi, functionName: "isRegistered", args: [address!],
    query: { enabled: !!contracts.registry.address && !!address },
  });
  const leases = useIds(contracts.rental, "agreementsOf", address);
  const projects = useIds(contracts.milestone, "agreementsOf", address);
  const societies = useIds(contracts.ledger, "societiesOf", address);
  const disputes = useIds(contracts.resolver, "disputesOf", address);

  if (!contracts.registry.address) {
    return <Notice>The NestLedger contracts are not deployed on this network yet. The dashboard fills in once they are.</Notice>;
  }
  if (registered.data === false) {
    return (
      <Notice>
        This wallet has no NestLedger profile yet. <Link className="text-accent underline" href="/onboard">Create one</Link> (one transaction).
      </Notice>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <section className="card space-y-3 md:col-span-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-slate-900">Leases</h2>
          <Link href="/rent/new" className="btn-secondary">Offer a lease</Link>
        </div>
        {!contracts.rental.address ? (
          <p className="text-sm text-slate-500">RentalEscrow not deployed yet.</p>
        ) : leases.data?.length ? (
          <ul className="space-y-2">{[...leases.data].reverse().map((id) => <LeaseRow key={String(id)} id={id} viewer={address!} />)}</ul>
        ) : (
          <p className="text-sm text-slate-500">No leases yet.</p>
        )}
      </section>

      <PassportCard address={address!} />

      <IdList title="Renovation projects" ids={projects.data} deployed={!!contracts.milestone.address} href={(id) => `/build/${id}`} action={{ href: "/build/new", label: "Start a project" }} />
      <IdList title="Societies" ids={societies.data} deployed={!!contracts.ledger.address} href={(id) => `/society/${id}`} action={{ href: "/society/new", label: "Create a society" }} />
      <IdList title="Disputes you arbitrate" ids={disputes.data} deployed={!!contracts.resolver.address} href={(id) => `/arbiter/${id}`} />
    </div>
  );
}

function LeaseRow({ id, viewer }: { id: bigint; viewer: `0x${string}` }) {
  const { contracts } = useNest();
  const lease = useReadContract({
    address: contracts.rental.address!, abi: contracts.rental.abi, functionName: "getLease", args: [id],
    query: { refetchInterval: 4000 },
  });
  if (!lease.data) return <li className="text-sm text-slate-500">Lease #{String(id)}…</li>;
  const l = lease.data as unknown as LeaseView;
  const me = roleOf(l, viewer);
  const step = nextStep(l, Math.floor(Date.now() / 1000));
  const myTurn = step.who === me || step.who === "anyone";
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 p-3">
      <div className="space-y-1">
        <Link href={`/rent/${id}`} className="font-medium text-accent underline">Lease #{String(id)}</Link>{" "}
        <span className="text-xs capitalize text-slate-500">you are the {me}</span>
        <p className={`text-sm ${myTurn ? "font-medium text-slate-900" : "text-slate-600"}`}>
          {myTurn ? "Your turn: " : `Waiting on the ${step.who}: `}
          {step.text}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {step.deadline && <Countdown until={step.deadline} />}
        <StatusChip kind="lease" value={l.status} enumValues={LeaseStatus} />
      </div>
    </li>
  );
}

function PassportCard({ address }: { address: `0x${string}` }) {
  const { contracts } = useNest();
  const p = contracts.passport;
  const enabled = !!p.address;
  const tier = useReadContract({ address: p.address!, abi: p.abi, functionName: "tenantTier", args: [address], query: { enabled } });
  const score = useReadContract({ address: p.address!, abi: p.abi, functionName: "trustScore", args: [address], query: { enabled } });
  return (
    <section className="card space-y-2">
      <h2 className="font-semibold text-slate-900">NestPassport</h2>
      {enabled ? (
        <>
          <p className="text-sm text-slate-700">{tier.data !== undefined ? TIERS[Number(tier.data)] : "…"}</p>
          <p className="text-sm text-slate-700">Trust score: <span className="font-semibold">{score.data !== undefined ? String(score.data) : "…"}</span> / 1000</p>
          <Link className="text-sm text-accent underline" href={`/passport/${address}`}>Public passport page</Link>
        </>
      ) : (
        <p className="text-sm text-slate-500">NestPassport not deployed yet.</p>
      )}
    </section>
  );
}

function IdList({ title, ids, deployed, href, action }: {
  title: string; ids?: readonly bigint[]; deployed: boolean; href: (id: string) => string; action?: { href: string; label: string };
}) {
  return (
    <section className="card space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold text-slate-900">{title}</h2>
        {action && deployed && <Link href={action.href} className="text-sm text-accent underline">{action.label}</Link>}
      </div>
      {!deployed ? (
        <p className="text-sm text-slate-500">Contract not deployed yet.</p>
      ) : ids?.length ? (
        <ul className="flex flex-wrap gap-2">
          {ids.map((id) => (
            <li key={String(id)}><Link className="chip bg-slate-100 text-accent" href={href(String(id))}>#{String(id)}</Link></li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-500">None yet.</p>
      )}
    </section>
  );
}
