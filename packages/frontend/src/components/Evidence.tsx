"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Bundle, MoveInReport, MoveOutReport } from "@nestledger/shared/schemas";
import { fetchEvidenceObjectUrl, getManifest, getReport } from "@/lib/api";
import { useAuth } from "@/lib/auth";

/** A private evidence photo, fetched with the session JWT. */
export function EvidenceImage({ hash, alt, className = "" }: { hash?: string; alt: string; className?: string }) {
  const { session } = useAuth();
  const q = useQuery({
    queryKey: ["evidence", hash, session?.token],
    queryFn: () => fetchEvidenceObjectUrl(hash!),
    enabled: !!hash && !!session,
    staleTime: Infinity,
    retry: false,
  });
  useEffect(() => () => { if (q.data) URL.revokeObjectURL(q.data); }, [q.data]);
  if (!hash) return <div className={`flex items-center justify-center bg-slate-100 text-xs text-slate-500 ${className}`}>No photo</div>;
  if (q.isError) return <div className={`flex items-center justify-center bg-slate-100 text-xs text-slate-500 ${className}`}>Not visible to you</div>;
  if (!q.data) return <div className={`animate-pulse bg-slate-100 ${className}`} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={q.data} alt={alt} className={`object-cover ${className}`} />;
}

export function useBundle(hash?: string | null) {
  const { session } = useAuth();
  return useQuery({
    queryKey: ["manifest", hash],
    queryFn: () => getManifest<Bundle>(hash!),
    enabled: !!hash && !!session && !/^0x0+$/.test(hash),
    staleTime: Infinity,
    retry: false,
  });
}

export function useReport<T>(hash?: string | null) {
  const { session } = useAuth();
  return useQuery({
    queryKey: ["report", hash],
    queryFn: () => getReport<T>(hash!),
    enabled: !!hash && !!session && !/^0x0+$/.test(hash),
    staleTime: Infinity,
    retry: false,
  });
}

export const photoByVantage = (b?: Bundle) =>
  new Map((b?.items ?? []).filter((i) => i.kind === "photo").map((i) => [i.vantageId ?? i.hash, i.hash]));

/** Move-in and move-out photo hashes by vantage, for side-by-side views. */
export function useBeforeAfter(report?: MoveOutReport) {
  const baseline = useReport<MoveInReport>(report?.baselineReportHash);
  const before = useBundle(baseline.data?.bundleHash);
  const after = useBundle(report?.moveOutBundleHash);
  return { before: photoByVantage(before.data), after: photoByVantage(after.data) };
}

export function BeforeAfter({ before, after, label }: { before?: string; after?: string; label: string }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <figure>
        <EvidenceImage hash={before} alt={`${label} at move-in`} className="h-32 w-full rounded" />
        <figcaption className="text-xs text-slate-500">Move-in</figcaption>
      </figure>
      <figure>
        <EvidenceImage hash={after} alt={`${label} at move-out`} className="h-32 w-full rounded" />
        <figcaption className="text-xs text-slate-500">Move-out</figcaption>
      </figure>
    </div>
  );
}
