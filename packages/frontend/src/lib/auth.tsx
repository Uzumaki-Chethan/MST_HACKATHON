"use client";

// SIWE login (SPEC §8.1): /auth/nonce → personal_sign → /auth/verify. JWT in memory + sessionStorage.
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { createSiweMessage } from "viem/siwe";
import { useAccount, useSignMessage } from "wagmi";
import { getNonce, setAuthToken, verifySiwe } from "./api";
import { appChain } from "./wagmi";

const STORAGE_KEY = "nestledger.session";

type Session = { token: string; address: string };
type AuthState = {
  session: Session | null;
  signingIn: boolean;
  signIn: () => Promise<void>;
  signOut: () => void;
};

const AuthContext = createContext<AuthState | null>(null);

function readStored(): Session | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function store(s: Session | null) {
  try {
    if (s) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // storage unavailable (private mode): the in-memory token still works for this tab
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [session, setSession] = useState<Session | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  const apply = useCallback((s: Session | null) => {
    setSession(s);
    setAuthToken(s?.token ?? null);
    store(s);
  }, []);

  useEffect(() => {
    const stored = readStored();
    if (stored) apply(stored);
  }, [apply]);

  // A session belongs to one wallet: switching accounts in BridgeKey signs you out.
  useEffect(() => {
    if (session && address && session.address.toLowerCase() !== address.toLowerCase()) apply(null);
  }, [address, session, apply]);

  const signIn = useCallback(async () => {
    if (!address) throw new Error("Connect BridgeKey first");
    setSigningIn(true);
    try {
      const { nonce } = await getNonce();
      const message = createSiweMessage({
        address,
        chainId: appChain.id,
        domain: window.location.host,
        uri: window.location.origin,
        nonce,
        version: "1",
        statement: "Sign in to NestLedger. This signature costs nothing and moves no funds.",
        issuedAt: new Date(),
      });
      const signature = await signMessageAsync({ message });
      const { token } = await verifySiwe(message, signature);
      apply({ token, address });
    } finally {
      setSigningIn(false);
    }
  }, [address, signMessageAsync, apply]);

  const signOut = useCallback(() => apply(null), [apply]);

  return <AuthContext.Provider value={{ session, signingIn, signIn, signOut }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}
