"use client";

import { useEffect, useState } from "react";

function fmt(s: number) {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

/** Current unix seconds, ticking every second. */
export function useNow() {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/**
 * Live timer to a unix-seconds deadline. At zero it renders `children`: the permissionless action
 * ("Finalize now") so nobody has to wait for the keeper. `prefix` ("closes in ") shows only while time is left.
 */
export function Countdown({ until, prefix, children }: { until: number | bigint; prefix?: React.ReactNode; children?: React.ReactNode }) {
  const target = Number(until);
  const left = target - useNow();
  if (left <= 0) return <>{children ?? <span className="text-sm text-slate-500">Time&apos;s up</span>}</>;
  return <>{prefix}<span className="font-mono text-sm tabular-nums text-slate-700">{fmt(left)}</span></>;
}
