import { formatINR, formatMSTC, weiToInr } from "@nestledger/shared";

/** Every amount in both units (SPEC §4.5): "0.18 tMSTC" with "≈ ₹1,80,000 (demo rate)" underneath. */
export function Amount({ wei, inline = false }: { wei: bigint | string; inline?: boolean }) {
  const w = typeof wei === "bigint" ? wei : BigInt(wei);
  const inr = `≈ ${formatINR(weiToInr(w))} (demo rate)`;
  if (inline) {
    return (
      <span>
        <span className="font-medium">{formatMSTC(w)}</span> <span className="text-xs text-slate-500">{inr}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex flex-col leading-tight">
      <span className="font-medium">{formatMSTC(w)}</span>
      <span className="text-xs text-slate-500">{inr}</span>
    </span>
  );
}
