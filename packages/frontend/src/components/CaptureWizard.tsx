"use client";

// Walks the inspection template vantage by vantage, uploads each photo, then posts the bundle manifest.
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { useAccount } from "wagmi";
import { INSPECTION_TEMPLATES, type Vantage } from "@nestledger/shared";
import type { Bundle } from "@nestledger/shared/schemas";
import { createCaptureSession, getCaptureSession, postManifest, uploadEvidence, type EvidenceChecks } from "@/lib/api";
import { encodePlan } from "@/lib/capture";
import { describeError } from "@/lib/labels";
import { LiveCapture } from "./LiveCapture";

type Context = Bundle["context"];
type Shot = {
  hash: `0x${string}`;
  mime: string;
  phash: string | null;
  checks: EvidenceChecks | null;
  captureMode: "live" | "upload";
  capturedAt?: string;
  geo?: { lat: number; lng: number; acc: number };
  fromPhone?: boolean;
};

const ALLOW_UPLOAD = process.env.NEXT_PUBLIC_ALLOW_UPLOAD === "1";

export function checkBadges(checks: EvidenceChecks | null | undefined, captureMode?: "live" | "upload"): string[] {
  const out: string[] = [];
  if (captureMode === "upload") out.push("Uploaded — not live camera");
  if (!checks) return out;
  if (checks.reusedOf) out.push("Looks reused");
  if (checks.nearDuplicateOf) out.push("Near-duplicate");
  if (checks.fresh === false) out.push("Not fresh");
  // With uploads enabled for the demo (prepared, labelled images), the upload badge already says where the photo
  // came from; the backend's DEMO_UPLOADS switch stops a missing EXIF time from zeroing its AI support.
  if (checks.stale && !ALLOW_UPLOAD) out.push("Old or missing photo time");
  if (checks.geoOk === false) out.push("Taken away from the property");
  return out;
}

export function useGeo() {
  const [geo, setGeo] = useState<Shot["geo"]>();
  useEffect(() => {
    navigator.geolocation?.getCurrentPosition(
      (p) => setGeo({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }),
      () => undefined,
      { enableHighAccuracy: true, timeout: 5000 },
    );
  }, []);
  return geo;
}

export function CaptureWizard({
  context,
  template = "compact",
  vantages: customVantages,
  ghosts = {},
  onDone,
}: {
  context: Context;
  template?: "full" | "compact";
  /** Overrides the room template, e.g. a milestone's agreed vantage points. */
  vantages?: Vantage[];
  ghosts?: Record<string, string>;
  onDone: (bundleHash: `0x${string}`, bundle: Bundle) => void;
}) {
  const { address } = useAccount();
  const vantages = customVantages?.length ? customVantages : INSPECTION_TEMPLATES[template];
  const [shots, setShots] = useState<Record<string, Shot>>({});
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const geo = useGeo();

  const v = vantages[step];
  const done = vantages.every((x) => shots[x.vantageId]);

  const upload = async (blob: Blob, capturedAt: string, captureMode: "live" | "upload") => {
    setBusy(true);
    setError(null);
    try {
      const res = await uploadEvidence(blob, {
        context, kind: "photo", room: v.room, vantageId: v.vantageId, captureMode, capturedAt, geo,
      });
      setShots((s) => ({ ...s, [v.vantageId]: { hash: res.hash, mime: res.mime, phash: res.phash, checks: res.checks, capturedAt, captureMode, geo } }));
      if (step < vantages.length - 1) setStep(step + 1);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    if (!address) return;
    setBusy(true);
    setError(null);
    try {
      const bundle: Bundle = {
        schema: "nestledger.bundle.v1",
        context,
        createdBy: address,
        createdAt: new Date().toISOString(),
        items: vantages.map((x) => {
          const s = shots[x.vantageId];
          return {
            hash: s.hash, kind: "photo", mime: s.mime, room: x.room, vantageId: x.vantageId, captureMode: s.captureMode,
            ...(s.capturedAt ? { capturedAt: s.capturedAt } : {}),
            ...(s.geo ? { geo: s.geo } : {}),
            ...(s.phash ? { phash: s.phash } : {}),
            ...(s.checks ? { checks: s.checks } : {}),
          };
        }),
      };
      const { hash } = await postManifest(bundle);
      onDone(hash, bundle);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <ol className="flex flex-wrap gap-2 text-xs">
        {vantages.map((x, i) => (
          <li key={x.vantageId}>
            <button
              onClick={() => setStep(i)}
              className={`chip ${i === step ? "bg-accent text-white" : shots[x.vantageId] ? "bg-accent-light text-accent-dark" : "bg-slate-100 text-slate-600"}`}
            >
              {shots[x.vantageId] ? "✓ " : ""}
              {x.label}
            </button>
          </li>
        ))}
      </ol>

      <div className="card space-y-3">
        <p className="font-medium text-slate-800">
          {step + 1}/{vantages.length}: {v.label}
        </p>
        <LiveCapture key={v.vantageId} ghostUrl={ghosts[v.vantageId]} busy={busy} onCapture={({ blob, capturedAt }) => upload(blob, capturedAt, "live")} />
        {ALLOW_UPLOAD && (
          <label className="block text-xs text-slate-600">
            Or upload a file (marked &quot;Uploaded — not live camera&quot;):{" "}
            <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0], new Date().toISOString(), "upload")} />
          </label>
        )}
        {shots[v.vantageId] && (
          <p className="text-xs text-slate-600">
            {shots[v.vantageId].fromPhone ? "Received from your phone." : "Captured."}{" "}
            {checkBadges(shots[v.vantageId].checks, shots[v.vantageId].captureMode).map((b) => (
              <span key={b} className="chip mr-1 bg-amber-100 text-amber-800">{b}</span>
            ))}
            Capture again to replace it.
          </p>
        )}
      </div>

      <PhoneHandoff
        context={context}
        template={customVantages?.length ? "custom" : template}
        vantages={vantages}
        onPhoto={(vantageId, shot) => setShots((s) => ({ ...s, [vantageId]: shot }))}
      />

      {error && <p className="text-sm text-red-700">{error}</p>}
      <button className="btn-primary w-full" disabled={!done || busy} onClick={finish}>
        {done ? "Save photo set" : `Capture all ${vantages.length} views to continue`}
      </button>
    </div>
  );
}

/**
 * §8.4 QR handoff: opens a 30-minute capture session, shows its link as a QR code and polls
 * GET /capture-sessions/:token. Each photo the phone sends lands in the wizard as if taken here.
 */
function PhoneHandoff({
  context,
  template,
  vantages,
  onPhoto,
}: {
  context: Context;
  template: string;
  vantages: Vantage[];
  onPhoto: (vantageId: string, shot: Shot) => void;
}) {
  const [session, setSession] = useState<{ token: string; link: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const seen = useRef<Record<string, string>>({});

  const open = async () => {
    setOpening(true);
    setError(null);
    try {
      const { token, url } = await createCaptureSession({ type: context.type, id: context.id }, context.stage, template);
      setSession({ token, link: `${url}#${encodePlan({ context, vantages })}` });
    } catch (e) {
      setError(describeError(e));
    } finally {
      setOpening(false);
    }
  };

  const poll = useQuery({
    queryKey: ["capture-session", session?.token],
    queryFn: () => getCaptureSession(session!.token),
    enabled: !!session,
    refetchInterval: 3000,
  });

  useEffect(() => {
    for (const u of poll.data?.uploads ?? []) {
      if (!u.vantageId || !vantages.some((x) => x.vantageId === u.vantageId) || seen.current[u.vantageId] === u.hash) continue;
      seen.current[u.vantageId] = u.hash;
      // The phone page only takes live camera shots (canvas → JPEG); its capture time and geotag are in the
      // evidence record, and the integrity checks (freshness, reuse, geofence) come back with the upload.
      onPhoto(u.vantageId, { hash: u.hash, mime: "image/jpeg", phash: u.checks?.phash ?? null, checks: u.checks, captureMode: "live", fromPhone: true });
    }
  }, [poll.data, vantages, onPhoto]);

  if (!session) {
    return (
      <div className="text-sm text-slate-600">
        <button className="btn-secondary w-full" disabled={opening} onClick={open}>
          {opening ? "Opening…" : "Use my phone camera instead (QR code)"}
        </button>
        {error && <p className="mt-2 text-red-700">{error}</p>}
      </div>
    );
  }

  const received = new Set((poll.data?.uploads ?? []).map((u) => u.vantageId)).size;
  const expires = poll.data ? new Date(poll.data.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;
  return (
    <div className="card flex flex-col items-center gap-3 text-center sm:flex-row sm:text-left">
      <QRCodeSVG value={session.link} size={160} className="shrink-0" />
      <div className="min-w-0 space-y-1 text-sm text-slate-600">
        <p className="font-medium text-slate-800">Scan with your phone camera</p>
        <p>Open the link in the phone&apos;s normal browser; no wallet is needed there. Photos appear here as they arrive, then you save the set and sign on this laptop.</p>
        <p className="text-xs">
          {received}/{vantages.length} received{expires ? ` · link valid until ${expires}` : ""}
          {poll.isError ? " · could not check for new photos, retrying" : ""}
        </p>
        <a href={session.link} target="_blank" rel="noreferrer" className="block break-all text-xs text-accent underline">
          {session.link.split("#")[0]}
        </a>
      </div>
    </div>
  );
}
