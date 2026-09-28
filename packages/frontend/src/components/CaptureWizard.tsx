"use client";

// Walks the inspection template vantage by vantage, uploads each photo, then posts the bundle manifest.
import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { INSPECTION_TEMPLATES } from "@nestledger/shared";
import type { Bundle } from "@nestledger/shared/schemas";
import { postManifest, uploadEvidence, type EvidenceChecks, type EvidenceUpload } from "@/lib/api";
import { describeError } from "@/lib/labels";
import { LiveCapture } from "./LiveCapture";

type Context = Bundle["context"];
type Shot = { upload: EvidenceUpload; capturedAt: string; captureMode: "live" | "upload"; geo?: { lat: number; lng: number; acc: number } };

const ALLOW_UPLOAD = process.env.NEXT_PUBLIC_ALLOW_UPLOAD === "1";

export function checkBadges(checks: EvidenceChecks | null | undefined, captureMode?: "live" | "upload"): string[] {
  const out: string[] = [];
  if (captureMode === "upload") out.push("Not live-captured");
  if (!checks) return out;
  if (checks.reusedOf) out.push("Looks reused");
  if (checks.nearDuplicateOf) out.push("Near-duplicate");
  if (checks.fresh === false) out.push("Not fresh");
  if (checks.stale) out.push("Old or missing photo time");
  if (checks.geoOk === false) out.push("Taken away from the property");
  return out;
}

function useGeo() {
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
  template,
  ghosts = {},
  onDone,
}: {
  context: Context;
  template: "full" | "compact";
  ghosts?: Record<string, string>;
  onDone: (bundleHash: `0x${string}`, bundle: Bundle) => void;
}) {
  const { address } = useAccount();
  const vantages = INSPECTION_TEMPLATES[template];
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
      setShots((s) => ({ ...s, [v.vantageId]: { upload: res, capturedAt, captureMode, geo } }));
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
            hash: s.upload.hash, kind: "photo", mime: s.upload.mime, room: x.room, vantageId: x.vantageId,
            captureMode: s.captureMode, capturedAt: s.capturedAt,
            ...(s.geo ? { geo: s.geo } : {}),
            ...(s.upload.phash ? { phash: s.upload.phash } : {}),
            ...(s.upload.checks ? { checks: s.upload.checks } : {}),
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
            Or upload a file (marked &quot;not live-captured&quot;):{" "}
            <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0], new Date().toISOString(), "upload")} />
          </label>
        )}
        {shots[v.vantageId] && (
          <p className="text-xs text-slate-600">
            Captured.{" "}
            {checkBadges(shots[v.vantageId].upload.checks, shots[v.vantageId].captureMode).map((b) => (
              <span key={b} className="chip mr-1 bg-amber-100 text-amber-800">{b}</span>
            ))}
            Capture again to replace it.
          </p>
        )}
      </div>

      {error && <p className="text-sm text-red-700">{error}</p>}
      <button className="btn-primary w-full" disabled={!done || busy} onClick={finish}>
        {done ? "Save photo set" : `Capture all ${vantages.length} views to continue`}
      </button>
    </div>
  );
}
