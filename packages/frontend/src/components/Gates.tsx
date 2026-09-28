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

/** Shown while the contracts have no address on this chain (before Laptop 1's deploy). */
export function RequireDeployed({ address, name, children }: { address?: string; name: string; children: React.ReactNode }) {
  if (!address) {
    return <Notice>{name} is not deployed on {appChain.name} yet. This page works as soon as the contracts are live.</Notice>;
  }
  return <>{children}</>;
}

export function Notice({ children, tone = "info" }: { children: React.ReactNode; tone?: "info" | "warn" | "error" }) {
  const style = { info: "border-slate-200 bg-slate-50", warn: "border-amber-300 bg-amber-50", error: "border-red-300 bg-red-50" }[tone];
  return <div className={`rounded-md border p-4 text-sm text-slate-700 ${style}`}>{children}</div>;
}
