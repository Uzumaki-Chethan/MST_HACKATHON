"use client";

import { useEffect, useState } from "react";

function fmt(s: number) {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

/**
 * Live timer to a unix-seconds deadline. At zero it renders `children`: the permissionless action
 * ("Finalize now") so nobody has to wait for the keeper.
 */
export function Countdown({ until, children }: { until: number | bigint; children?: React.ReactNode }) {
  const target = Number(until);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  const left = target - now;
  if (left <= 0) return <>{children ?? <span className="text-sm text-slate-500">Time&apos;s up</span>}</>;
  return <span className="font-mono text-sm tabular-nums text-slate-700">{fmt(left)}</span>;
}
