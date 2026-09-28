// SPEC §4.5. On-chain amounts are wei of native tMSTC; INR is display-only at a labelled demo rate.
import { formatEther } from "viem";

// Next.js inlines NEXT_PUBLIC_* only for literal `process.env.NEXT_PUBLIC_X` reads, so no aliasing here.
function readRate(): string | undefined {
  try {
    return process.env.NEXT_PUBLIC_INR_PER_MSTC || process.env.INR_PER_MSTC;
  } catch {
    return undefined; // no `process` in this runtime
  }
}

/** ₹ per 1 tMSTC. Default ₹10,00,000; override with NEXT_PUBLIC_INR_PER_MSTC / INR_PER_MSTC. */
export const DEMO_INR_PER_MSTC = Number(readRate() || 1_000_000);

const WEI_PER_MSTC = BigInt("1000000000000000000");
const HUNDRED = BigInt(100);
const RATE = BigInt(Math.round(DEMO_INR_PER_MSTC));

/** INR (paise precision) -> wei at the demo rate. */
export function inrToWei(inr: number): bigint {
  return (BigInt(Math.round(inr * 100)) * WEI_PER_MSTC) / (HUNDRED * RATE);
}

/** wei -> INR (rounded down to paise) at the demo rate. */
export function weiToInr(wei: bigint): number {
  return Number((wei * RATE * HUNDRED) / WEI_PER_MSTC) / 100;
}

/** "0.03 tMSTC" (up to 6 decimals, trailing zeros trimmed). */
export function formatMSTC(wei: bigint): string {
  const [whole, frac = ""] = formatEther(wei).split(".");
  const f = frac.slice(0, 6).replace(/0+$/, "");
  return `${whole}${f ? "." + f : ""} tMSTC`;
}

/** "₹1,80,000" with Indian digit grouping. */
export function formatINR(inr: number): string {
  return "₹" + inr.toLocaleString("en-IN", { maximumFractionDigits: Number.isInteger(inr) ? 0 : 2 });
}

/** "0.03 tMSTC (≈ ₹30,000 at demo rate)": the only way INR should reach a user. */
export function formatAmount(wei: bigint): string {
  return `${formatMSTC(wei)} (≈ ${formatINR(weiToInr(wei))} at demo rate)`;
}
