import { formatINR, formatMSTC, weiToInr } from "@nestledger/shared";

/** Every amount in both units (SPEC §4.5): "0.18 tMSTC" with "≈ ₹1,80,000 (demo rate)" underneath. */
/** `large` is for KPI tiles: a bigger MSTC figure over the INR line. */
export function Amount({ wei, inline = false, large = false }: { wei: bigint | string; inline?: boolean; large?: boolean }) {
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
    <span className={`inline-flex flex-col ${large ? "gap-1" : ""} leading-tight`}>
      <span className={large ? "text-xl font-semibold tabular-nums tracking-tight text-slate-900" : "font-medium"}>{formatMSTC(w)}</span>
      <span className="text-xs text-slate-500">{inr}</span>
    </span>
  );
}
