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

/** Hashes of photos that were uploaded from a file rather than taken with the live camera. */
export const uploadedPhotos = (b?: Bundle) =>
  new Set((b?.items ?? []).filter((i) => i.kind === "photo" && i.captureMode === "upload").map((i) => i.hash));

/** Move-in and move-out photo hashes by vantage, for side-by-side views. */
export function useBeforeAfter(report?: MoveOutReport) {
  const baseline = useReport<MoveInReport>(report?.baselineReportHash);
  const before = useBundle(baseline.data?.bundleHash);
  const after = useBundle(report?.moveOutBundleHash);
  return {
    before: photoByVantage(before.data),
    after: photoByVantage(after.data),
    uploaded: new Set([...uploadedPhotos(before.data), ...uploadedPhotos(after.data)]),
  };
}

/** §8.4: photos that didn't come from the live camera always say so. */
export function UploadedBadge() {
  return <span className="chip bg-amber-100 text-amber-800" title="Uploaded from a file, not taken with the in-app camera">Uploaded — not live camera</span>;
}

export function BeforeAfter({ before, after, label, uploaded }: { before?: string; after?: string; label: string; uploaded?: Set<string> }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {([["Move-in", before, "at move-in"], ["Move-out", after, "at move-out"]] as const).map(([caption, hash, when]) => (
        <figure key={caption} className="space-y-1">
          <EvidenceImage hash={hash} alt={`${label} ${when}`} className="h-32 w-full rounded" />
          <figcaption className="flex flex-wrap items-center gap-1 text-xs text-slate-500">
            {caption}
            {hash && uploaded?.has(hash) && <UploadedBadge />}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}
