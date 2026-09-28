"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import { addresses, explorerAddress, type ContractName } from "@nestledger/shared";
import { Amount } from "@/components/Amount";
import { SimulatedBadge } from "@/components/Badges";
import { AddressLink } from "@/components/TxLink";
import { API_URL, getHealth } from "@/lib/api";
import { DEMO_CAST } from "@/lib/demoCast";
import { appChain } from "@/lib/wagmi";

const CONTRACTS: ContractName[] = ["NestRegistry", "NestPassport", "RentalEscrow", "MilestoneEscrow", "DisputeResolver", "SocietyLedger", "TankerTrust"];

function Dot({ ok }: { ok: boolean | null }) {
  const c = ok === null ? "bg-slate-300" : ok ? "bg-accent" : "bg-red-500";
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${c}`} />;
}

export default function StatusPage() {
  const client = usePublicClient({ chainId: appChain.id });
  const health = useQuery({ queryKey: ["health"], queryFn: getHealth, refetchInterval: 5000, retry: false });
  const block = useQuery({ queryKey: ["block"], queryFn: () => client!.getBlockNumber(), enabled: !!client, refetchInterval: 5000 });
  const balances = useQuery({
    queryKey: ["castBalances"],
    queryFn: async () => Object.fromEntries(await Promise.all(DEMO_CAST.map(async (m) => [m.address, await client!.getBalance({ address: m.address })] as const))),
    enabled: !!client,
    refetchInterval: 15000,
  });
  const h = health.data;
  const deployed = addresses[appChain.id] ?? {};
  const aiMode = h?.llm;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">System status</h1>

      <section className="grid gap-4 sm:grid-cols-3">
        <div className="card space-y-1">
          <p className="text-sm font-medium text-slate-700"><Dot ok={block.data !== undefined} /> {appChain.name}</p>
          <p className="text-sm text-slate-600">Chain {appChain.id} · block {block.data !== undefined ? String(block.data) : "…"}</p>
        </div>
        <div className="card space-y-1">
          <p className="text-sm font-medium text-slate-700"><Dot ok={health.isError ? false : h ? h.rpcOk : null} /> Backend</p>
          <p className="break-all text-sm text-slate-600">{health.isError ? `Unreachable at ${API_URL}` : h ? `RPC ${h.rpcOk ? "ok" : "down"} · indexer lag ${h.indexerLag ?? "n/a"} blocks` : "Checking…"}</p>
        </div>
        <div className="card space-y-1">
          <p className="text-sm font-medium text-slate-700"><Dot ok={aiMode ? true : null} /> AI attestor</p>
          <p className="text-sm text-slate-600">{aiMode ? aiMode === "fixtures" ? <SimulatedBadge what="AI: fixture mode" /> : aiMode : "…"}</p>
          {h && <p className="text-xs text-slate-500">Agent gas: {h.attestorBalance} tMSTC · keeper: {h.keeperBalance} tMSTC</p>}
        </div>
      </section>

      <section className="card space-y-2">
        <h2 className="font-semibold text-slate-900">Contracts</h2>
        <ul className="space-y-1 text-sm">
          {CONTRACTS.map((n) => (
            <li key={n} className="flex flex-wrap items-center justify-between gap-2">
              <span><Dot ok={deployed[n] ? true : null} /> {n}</span>
              {deployed[n] ? (
                <a className="font-mono text-xs text-accent underline" href={explorerAddress(deployed[n]!)} target="_blank" rel="noreferrer">{deployed[n]} ↗</a>
              ) : (
                <span className="text-xs text-slate-500">not deployed yet</span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="card space-y-2">
        <h2 className="font-semibold text-slate-900">Demo cast</h2>
        <p className="text-xs text-slate-500">Fictional people, real testnet wallets. Scripted actors are marked.</p>
        <ul className="divide-y divide-slate-100 text-sm">
          {DEMO_CAST.map((m) => (
            <li key={m.alias} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
              <span className="flex flex-wrap items-center gap-2">
                <Link href={`/passport/${m.address}`} className="font-medium text-accent underline">{m.alias}</Link>
                <span className="text-slate-600">{m.role}</span>
                {m.scripted && <SimulatedBadge what="Scripted actor" />}
              </span>
              <span className="flex items-center gap-3">
                <AddressLink address={m.address} />
                {balances.data ? <Amount wei={balances.data[m.address]} inline /> : <span className="text-xs text-slate-400">…</span>}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
