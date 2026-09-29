"use client";

import { useAccount } from "wagmi";
import { useAuth } from "@/lib/auth";
import { appChain } from "@/lib/wagmi";

/** Renders children only with a connected wallet (and a SIWE session when `signedIn`). */
export function RequireWallet({ children, signedIn = false }: { children: React.ReactNode; signedIn?: boolean }) {
  const { isConnected, chainId } = useAccount();
  const { session } = useAuth();
  if (!isConnected) return <Notice>Connect BridgeKey (top right) to continue.</Notice>;
  if (chainId !== appChain.id) return <Notice>Switch BridgeKey to {appChain.name} (top right) to continue.</Notice>;
  if (signedIn && !session) return <Notice>Sign in (top right) so we can load your private evidence and reports. It is a free signature.</Notice>;
  return <>{children}</>;
}

/** Inline prompt for pages that work without a session but need one for private evidence (descriptions, photos). */
export function SignInHint({ what }: { what: string }) {
  const { isConnected } = useAccount();
  const { session, signIn, signingIn } = useAuth();
  if (!isConnected || session) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-slate-700">
      <span className="min-w-0 flex-1">Sign in to see {what}. It is a free signature, not a transaction.</span>
      <button className="btn-secondary" disabled={signingIn} onClick={() => signIn().catch(() => undefined)}>
        {signingIn ? "Signing in…" : "Sign in"}
      </button>
    </div>
  );
}

/** Shown while the contracts have no address on this chain (before Laptop 1's deploy). */
export function RequireDeployed({ address, name, children }: { address?: string; name: string; children: React.ReactNode }) {
  if (!address) {
    return <Notice>{name} is not deployed on {appChain.name} yet. This page works as soon as the contracts are live.</Notice>;
  }
  return <>{children}</>;
}

export function Notice({ children, tone = "info" }: { children: React.ReactNode; tone?: "info" | "warn" | "error" }) {
  const style = { info: "border-slate-200 bg-white", warn: "border-amber-200 bg-amber-50", error: "border-red-200 bg-red-50" }[tone];
  const dot = { info: "bg-accent", warn: "bg-amber-500", error: "bg-red-500" }[tone];
  return (
    <div className={`flex gap-3 rounded-xl border p-4 text-sm leading-relaxed text-slate-700 shadow-sm ${style}`}>
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
