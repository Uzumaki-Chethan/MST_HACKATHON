"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { TxLink } from "./TxLink";

type ToastKind = "pending" | "success" | "error";
type Toast = { id: number; kind: ToastKind; text: string; hash?: `0x${string}` };
type ToastApi = {
  show: (t: Omit<Toast, "id">) => number;
  update: (id: number, t: Partial<Omit<Toast, "id">>) => void;
  dismiss: (id: number) => void;
};

const ToastContext = createContext<ToastApi | null>(null);
let nextId = 1;

const STYLE: Record<ToastKind, string> = {
  pending: "border-slate-300 bg-white",
  success: "border-accent bg-accent-light",
  error: "border-red-300 bg-red-50",
};

export function Toaster({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);
  const autoDismiss = useCallback((id: number, kind: ToastKind) => {
    if (kind !== "pending") setTimeout(() => dismiss(id), kind === "error" ? 12_000 : 8_000);
  }, [dismiss]);

  const show = useCallback((t: Omit<Toast, "id">) => {
    const id = nextId++;
    setToasts((ts) => [...ts, { ...t, id }]);
    autoDismiss(id, t.kind);
    return id;
  }, [autoDismiss]);

  const update = useCallback((id: number, patch: Partial<Omit<Toast, "id">>) => {
    setToasts((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    if (patch.kind) autoDismiss(id, patch.kind);
  }, [autoDismiss]);

  return (
    <ToastContext.Provider value={{ show, update, dismiss }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} role="status" className={`rounded-md border p-3 text-sm shadow ${STYLE[t.kind]}`}>
            <div className="flex items-start justify-between gap-2">
              <span>{t.kind === "pending" && "⏳ "}{t.text}</span>
              <button className="text-slate-400 hover:text-slate-600" onClick={() => dismiss(t.id)} aria-label="Dismiss">
                ×
              </button>
            </div>
            {t.hash && (
              <div className="mt-1">
                <TxLink hash={t.hash} />
              </div>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast outside Toaster");
  return ctx;
}
