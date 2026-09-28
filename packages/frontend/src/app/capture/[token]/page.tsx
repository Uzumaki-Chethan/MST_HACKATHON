"use client";

// SPEC §8.4 QR handoff: the phone page. No wallet and no sign-in: uploads carry the session token
// (X-Capture-Token), which the backend scopes to one agreement for 30 minutes. The laptop picks up the
// photos, builds the bundle and signs.
import { useEffect, useState } from "react";
import { Notice } from "@/components/Gates";
import { checkBadges, useGeo } from "@/components/CaptureWizard";
import { LiveCapture } from "@/components/LiveCapture";
import { uploadEvidence, type EvidenceUpload } from "@/lib/api";
import { CONTEXT_TEXT, decodePlan, type CapturePlan } from "@/lib/capture";
import { describeError } from "@/lib/labels";

export default function PhoneCapturePage({ params }: { params: { token: string } }) {
  const [plan, setPlan] = useState<CapturePlan | null | undefined>(undefined);
  useEffect(() => setPlan(decodePlan(window.location.hash)), []);

  if (plan === undefined) return <p className="text-sm text-slate-500">Opening the camera page…</p>;
  if (!plan) return <Notice tone="error">This capture link is incomplete. Scan the QR code on the laptop again.</Notice>;
  return <PhoneCapture token={params.token} plan={plan} />;
}

function PhoneCapture({ token, plan }: { token: string; plan: CapturePlan }) {
  const { context, vantages } = plan;
  const [sent, setSent] = useState<Record<string, EvidenceUpload>>({});
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const geo = useGeo();

  const v = vantages[step];
  const allSent = vantages.every((x) => sent[x.vantageId]);

  const upload = async (blob: Blob, capturedAt: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await uploadEvidence(
        blob,
        { context, kind: "photo", room: v.room, vantageId: v.vantageId, captureMode: "live", capturedAt, geo },
        token,
      );
      setSent((s) => ({ ...s, [v.vantageId]: res }));
      const next = vantages.findIndex((x, i) => i !== step && !sent[x.vantageId]);
      if (next >= 0) setStep(next);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Phone capture</h1>
        <p className="text-sm text-slate-600">
          {CONTEXT_TEXT[context.type] ?? context.type} #{context.id} · {context.stage}. Each photo goes straight to the laptop that showed the QR
          code. The link works for 30 minutes and only for this agreement.
        </p>
      </div>

      <ol className="flex flex-wrap gap-2 text-xs">
        {vantages.map((x, i) => (
          <li key={x.vantageId}>
            <button
              onClick={() => setStep(i)}
              className={`chip ${i === step ? "bg-accent text-white" : sent[x.vantageId] ? "bg-accent-light text-accent-dark" : "bg-slate-100 text-slate-600"}`}
            >
              {sent[x.vantageId] ? "✓ " : ""}
              {x.label}
            </button>
          </li>
        ))}
      </ol>

      <div className="card space-y-3">
        <p className="font-medium text-slate-800">
          {step + 1}/{vantages.length}: {v.label}
        </p>
        <p className="text-xs text-slate-500">The reference photo for this angle is on the laptop screen; line up the same view.</p>
        <LiveCapture key={v.vantageId} busy={busy} onCapture={({ blob, capturedAt }) => upload(blob, capturedAt)} />
        {sent[v.vantageId] && (
          <p className="text-xs text-slate-600">
            Sent to the laptop.{" "}
            {checkBadges(sent[v.vantageId].checks, "live").map((b) => (
              <span key={b} className="chip mr-1 bg-amber-100 text-amber-800">{b}</span>
            ))}
            Capture again to replace it.
          </p>
        )}
      </div>

      {error && <p className="text-sm text-red-700">{error}</p>}
      {allSent ? (
        <Notice>All {vantages.length} photos are sent. Go back to the laptop to save the photo set and sign.</Notice>
      ) : (
        <p className="text-center text-xs text-slate-500">
          {Object.keys(sent).length}/{vantages.length} sent
        </p>
      )}
    </div>
  );
}
