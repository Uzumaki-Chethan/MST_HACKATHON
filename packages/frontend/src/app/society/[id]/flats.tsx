"use client";

import { useState } from "react";
import { isAddress } from "viem";
import { useAccount } from "wagmi";
import { inrToWei } from "@nestledger/shared";
import { Amount } from "@/components/Amount";
import { AddressLink } from "@/components/TxLink";
import type { FlatRow, SocietyData } from "@/hooks/useSociety";
import { useNest } from "@/hooks/useNest";
import { useTx } from "@/hooks/useTx";
import { paidThisMonth, sameAddr, ZERO_ADDR } from "@/lib/society";

export function FlatsTab({ id, data }: { id: string; data: SocietyData }) {
  const { address } = useAccount();
  const isAdmin = sameAddr(data.society.admin, address);
  return (
    <div className="space-y-4">
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-slate-500">
              <th className="py-1">Flat</th><th>Owner</th><th>Votes by</th><th>Weight</th><th>Maintenance</th><th>This month</th><th />
            </tr>
          </thead>
          <tbody>{data.flats.map((f) => <FlatRowView key={String(f.id)} f={f} />)}</tbody>
        </table>
        {!data.flats.length && <p className="text-sm text-slate-500">No flats yet.</p>}
        <p className="mt-2 text-xs text-slate-500">
          Tenants pay maintenance automatically with their rent through DepositLock. Owners pay here. One vote per flat, weighted, cast by the
          owner or the delegate they choose (usually their tenant).
        </p>
      </div>
      {isAdmin && <AddFlat id={id} count={data.flats.length} />}
    </div>
  );
}

function FlatRowView({ f }: { f: FlatRow }) {
  const { address } = useAccount();
  const { contracts } = useNest();
  const { send, pending } = useTx();
  const [delegate, setDelegate] = useState("");
  const isOwner = sameAddr(f.owner, address);
  const ledger = contracts.ledger;
  return (
    <tr className="border-t border-slate-100 align-top">
      <td className="py-2 font-medium">{f.label}</td>
      <td><AddressLink address={f.owner} />{f.tenant !== ZERO_ADDR && <p className="text-xs text-slate-500">tenant <AddressLink address={f.tenant} /></p>}</td>
      <td>{f.delegate === ZERO_ADDR ? <span className="text-xs text-slate-500">owner</span> : <AddressLink address={f.delegate} />}</td>
      <td>{f.weight}</td>
      <td><Amount wei={f.maintenance} /></td>
      <td>{paidThisMonth(f) ? <span className="text-accent-dark">✓ paid</span> : <span className="text-slate-400">not yet</span>}</td>
      <td className="space-y-1">
        {f.maintenance > BigInt(0) && (
          <button className="btn-secondary px-2 py-1 text-xs" disabled={pending}
            onClick={() => send({ address: ledger.address!, abi: ledger.abi, functionName: "payMaintenance", args: [f.id], value: f.maintenance }, `Pay maintenance for ${f.label}`).catch(() => undefined)}>
            Pay
          </button>
        )}
        {isOwner && (
          <div className="flex gap-1">
            <input className="w-28 rounded border border-slate-300 px-1 text-xs" placeholder="delegate 0x…" value={delegate} onChange={(e) => setDelegate(e.target.value.trim())} />
            <button className="text-xs text-accent underline" disabled={pending || (!!delegate && !isAddress(delegate))}
              onClick={() => send({ address: ledger.address!, abi: ledger.abi, functionName: "delegateVote", args: [f.id, delegate || ZERO_ADDR] }, delegate ? "Delegate vote" : "Take back vote").catch(() => undefined)}>
              {delegate ? "Delegate" : "Clear"}
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}

function AddFlat({ id, count }: { id: string; count: number }) {
  const { contracts } = useNest();
  const { send, pending } = useTx();
  const [label, setLabel] = useState("");
  const [owner, setOwner] = useState("");
  const [weight, setWeight] = useState(1);
  const [maintenance, setMaintenance] = useState(3000);
  const ok = label.trim() && isAddress(owner) && weight >= 1 && count < 50;
  return (
    <div className="card space-y-3">
      <h3 className="font-semibold text-slate-900">Add a flat (society admin)</h3>
      <div className="grid gap-2 sm:grid-cols-4">
        <input className="rounded border border-slate-300 px-2 py-1 text-sm" placeholder="Label, e.g. B-304" value={label} onChange={(e) => setLabel(e.target.value)} />
        <input className="rounded border border-slate-300 px-2 py-1 font-mono text-sm" placeholder="Owner 0x…" value={owner} onChange={(e) => setOwner(e.target.value.trim())} />
        <label className="text-xs text-slate-600">Weight <input type="number" min={1} className="w-full rounded border border-slate-300 px-2 py-1 text-sm" value={weight} onChange={(e) => setWeight(Number(e.target.value))} /></label>
        <label className="text-xs text-slate-600">Maintenance ₹/month <input type="number" min={0} className="w-full rounded border border-slate-300 px-2 py-1 text-sm" value={maintenance} onChange={(e) => setMaintenance(Number(e.target.value))} /></label>
      </div>
      <button className="btn-primary" disabled={!ok || pending}
        onClick={() => send({ address: contracts.ledger.address!, abi: contracts.ledger.abi, functionName: "addFlat", args: [BigInt(id), label.trim(), owner, weight, inrToWei(maintenance)] }, `Add flat ${label}`)
          .then(() => { setLabel(""); setOwner(""); }).catch(() => undefined)}>
        Add flat
      </button>
      {count >= 50 && <p className="text-xs text-slate-500">A society holds at most 50 flats in this version.</p>}
    </div>
  );
}
