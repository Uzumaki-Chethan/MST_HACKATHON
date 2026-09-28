"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAccount, useBalance, useReadContract } from "wagmi";
import { Kind, type KindName } from "@nestledger/shared";
import type { ProfileMeta } from "@nestledger/shared/schemas";
import { Notice, RequireDeployed, RequireWallet } from "@/components/Gates";
import { useNest } from "@/hooks/useNest";
import { useTx } from "@/hooks/useTx";
import { gasDrip, postManifest } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { describeError } from "@/lib/labels";
import { appChain } from "@/lib/wagmi";

const ROLE_TEXT: Record<KindName, string> = {
  TENANT: "Tenant: I rent a flat",
  LANDLORD: "Landlord: I rent out a flat",
  HOMEOWNER: "Homeowner: I'm renovating",
  CONTRACTOR: "Contractor: I do renovation work",
  VENDOR: "Vendor: I bill a society",
  SUPPLIER: "Water supplier",
  COMMITTEE: "Society committee member",
  ARBITER: "Arbiter: I resolve disputes",
};

export default function OnboardPage() {
  return (
    <div className="mx-auto max-w-xl space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Create your NestLedger profile</h1>
      <RequireWallet signedIn>
        <OnboardForm />
      </RequireWallet>
    </div>
  );
}

function OnboardForm() {
  const router = useRouter();
  const { address } = useAccount();
  const { session } = useAuth();
  const { contracts } = useNest();
  const { send, pending } = useTx();
  const [roles, setRoles] = useState<KindName[]>(["TENANT"]);
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [dripNote, setDripNote] = useState<string | null>(null);

  const registry = contracts.registry;
  const registered = useReadContract({
    address: registry.address!, abi: registry.abi, functionName: "isRegistered", args: [address!],
    query: { enabled: !!registry.address && !!address },
  });
  const balance = useBalance({ address, chainId: appChain.id });

  const toggle = (k: KindName) => setRoles((r) => (r.includes(k) ? r.filter((x) => x !== k) : [...r, k]));

  const submit = async () => {
    if (!registry.address || !session) return;
    setError(null);
    try {
      const kinds = roles.reduce((m, k) => m | Kind[k], 0);
      const profile: ProfileMeta = {
        schema: "nestledger.profile.v1",
        createdAt: new Date().toISOString(),
        kinds: roles,
        ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
      };
      const { hash: metaHash } = await postManifest(profile);
      await send({ address: registry.address, abi: registry.abi, functionName: "register", args: [kinds, metaHash] }, "Create profile");
      try {
        await gasDrip();
        setDripNote("We sent you a little tMSTC for transaction fees.");
      } catch {
        // one drip per address; an error here never blocks onboarding
      }
      router.push("/dashboard");
    } catch (e) {
      setError(describeError(e));
    }
  };

  return (
    <RequireDeployed address={registry.address} name="NestRegistry">
      {registered.data ? (
        <Notice>
          This wallet already has a profile and a NestPassport. <Link className="text-accent underline" href="/dashboard">Go to your dashboard</Link>.
        </Notice>
      ) : (
        <div className="card space-y-4">
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-medium text-slate-700">What will you use NestLedger for? (pick any)</legend>
            {(Object.keys(Kind) as KindName[]).filter((k) => k !== "SUPPLIER").map((k) => (
              <label key={k} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={roles.includes(k)} onChange={() => toggle(k)} />
                {ROLE_TEXT[k]}
              </label>
            ))}
          </fieldset>
          <label className="block text-sm">
            <span className="text-slate-700">Display name (optional; no phone numbers or IDs)</span>
            <input className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" maxLength={64} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </label>
          <p className="text-xs text-slate-500">
            Roles are for display only. Your profile mints a soulbound NestPassport that records your reputation. Only a hash of
            the profile goes on-chain.
          </p>
          {balance.data && balance.data.value === BigInt(0) && (
            <Notice tone="warn">
              This wallet has no tMSTC for the transaction fee. Claim some at{" "}
              <a className="underline" href="https://faucet.masterstroke.academy" target="_blank" rel="noreferrer">the MST faucet</a>.
            </Notice>
          )}
          {error && <p className="text-sm text-red-700">{error}</p>}
          {dripNote && <p className="text-sm text-accent">{dripNote}</p>}
          <button className="btn-primary w-full" disabled={pending || roles.length === 0} onClick={submit}>
            {pending ? "Waiting for BridgeKey…" : "Create profile and passport"}
          </button>
        </div>
      )}
    </RequireDeployed>
  );
}
