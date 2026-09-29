"use client";

import { useEffect, useState } from "react";
import { useAccount, useConnect, useDisconnect, type Connector } from "wagmi";
import { useAuth } from "@/lib/auth";
import { describeError } from "@/lib/labels";
import { ensureAppChain } from "@/lib/network";
import { appChain } from "@/lib/wagmi";
import { shortHex } from "./TxLink";

/** Prefer the EIP-6963 provider named BridgeKey, else the generic injected one (window.ethereum). */
function pickConnector(connectors: readonly Connector[]): Connector | undefined {
  return connectors.find((c) => /bridgekey/i.test(c.name)) ?? connectors.find((c) => c.id === "injected");
}

export function ConnectBridgeKey() {
  const { address, chainId, connector: active, isConnected } = useAccount();
  const { connectAsync, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { session, signIn, signOut, signingIn } = useAuth();
  const [mounted, setMounted] = useState(false);
  const [hasWallet, setHasWallet] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
    setHasWallet(typeof window !== "undefined" && (!!(window as { ethereum?: unknown }).ethereum || connectors.some((c) => c.id !== "injected")));
  }, [connectors]);

  if (!mounted) return <div className="h-9" />;

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(describeError(e));
    }
  };

  const guard = async (c: Connector) => ensureAppChain((await c.getProvider()) as Parameters<typeof ensureAppChain>[0]);

  if (!isConnected || !address) {
    const connector = pickConnector(connectors);
    if (!hasWallet || !connector) {
      return (
        <details className="group relative">
          <summary className="chip cursor-pointer list-none bg-amber-50 py-1 text-amber-800 ring-1 ring-inset ring-amber-200 hover:bg-amber-100 [&::-webkit-details-marker]:hidden">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            BridgeKey not detected
          </summary>
          <div className="card absolute right-0 z-40 mt-2 w-72 p-4 text-sm text-slate-600">
            Install the BridgeKey Chrome extension, or open this page in the BridgeKey Android app&apos;s browser. The public ledger,
            passports and status pages work without a wallet.
          </div>
        </details>
      );
    }
    return (
      <div className="flex flex-col items-end gap-1">
        <button
          className="btn-primary"
          disabled={isPending}
          onClick={() => run(async () => {
            await connectAsync({ connector });
            await guard(connector);
          })}
        >
          {isPending ? "Connecting…" : "Connect BridgeKey"}
        </button>
        {error && <p className="text-xs text-red-700">{error}</p>}
      </div>
    );
  }

  const wrongChain = chainId !== appChain.id;
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-sm text-slate-700 shadow-sm" title={address}>
          <span className={`h-2 w-2 rounded-full ${wrongChain ? "bg-amber-500" : "bg-emerald-500"}`} />
          {shortHex(address)}
        </span>
        {wrongChain ? (
          <button className="btn-primary" onClick={() => active && run(() => guard(active))}>
            Switch to {appChain.name}
          </button>
        ) : !session ? (
          <button className="btn-primary" disabled={signingIn} onClick={() => run(signIn)}>
            {signingIn ? "Check BridgeKey…" : "Sign in"}
          </button>
        ) : (
          <span className="chip bg-accent-light text-accent-dark">✓ Signed in</span>
        )}
        <button
          className="btn-ghost px-2.5"
          onClick={() => {
            signOut();
            disconnect();
          }}
        >
          Disconnect
        </button>
      </div>
      {error && <p className="max-w-xs text-right text-xs text-red-700">{error}</p>}
    </div>
  );
}
