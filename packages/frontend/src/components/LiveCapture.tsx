"use client";

// SPEC §8.4: rear camera, ghost of the reference/move-in photo at 35% (adjustable), capture to JPEG.
import { useEffect, useRef, useState } from "react";

export type Captured = { blob: Blob; capturedAt: string };

export function LiveCapture({ ghostUrl, onCapture, busy }: { ghostUrl?: string; onCapture: (c: Captured) => void; busy?: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [opacity, setOpacity] = useState(0.35);

  useEffect(() => {
    let stream: MediaStream | null = null;
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then((s) => {
        stream = s;
        if (video.current) video.current.srcObject = s;
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Camera unavailable"));
    if (!navigator.mediaDevices) setError("This browser has no camera access. Open the page in a normal phone browser.");
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, []);

  const capture = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext("2d")!.drawImage(v, 0, 0);
    const capturedAt = new Date().toISOString();
    canvas.toBlob((blob) => blob && onCapture({ blob, capturedAt }), "image/jpeg", 0.9);
  };

  if (error) return <p className="text-sm text-red-700">Camera: {error}</p>;
  return (
    <div className="space-y-2">
      <div className="relative overflow-hidden rounded-md bg-black">
        <video ref={video} autoPlay playsInline muted className="block w-full" />
        {ghostUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={ghostUrl} alt="Reference" style={{ opacity }} className="pointer-events-none absolute inset-0 h-full w-full object-cover" />
        )}
      </div>
      {ghostUrl && (
        <label className="flex items-center gap-2 text-xs text-slate-600">
          Ghost overlay
          <input type="range" min={0} max={0.8} step={0.05} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} />
        </label>
      )}
      <button className="btn-primary w-full" onClick={capture} disabled={busy}>
        {busy ? "Uploading…" : "Capture"}
      </button>
    </div>
  );
}
