// SPEC §6.6 — turn a landlord's rental claim + the stored move-out report into per-item support.
import { inrToWei } from "@nestledger/shared";
import type { AttestationReport, MoveOutReport, RentalClaim } from "@nestledger/shared/schemas";

export const MIN_CONFIDENCE = 0.6;

export type RentalAttestation = {
  supported: bigint[];
  score: number;
  mapping: AttestationReport["mapping"];
};

/**
 * Item 0 (unpaid rent) gets 0: the contract backs it from its own records.
 * Item i ≥ 1 with a findingId gets the finding's code-computed cost if it is deductible,
 * confidence ≥ 0.6 and its move-out photo passed integrity checks; everything else gets 0.
 */
export function buildRentalAttestation(args: {
  onchainItems: bigint[];
  claim: RentalClaim;
  report: MoveOutReport;
  taintedVantages: Set<string>;
}): RentalAttestation {
  const findings = new Map(args.report.findings.map((f) => [f.findingId, f]));
  const byIndex = new Map(args.claim.items.map((it) => [it.index, it]));
  const confidences: number[] = [];

  const mapping = args.onchainItems.map((claimed, item) => {
    const entry = (ref: string, supported: bigint, reason: string) => ({ item, ref, supportedWei: supported.toString(), reason });
    if (item === 0) return entry("unpaid_dues", BigInt(0), "Unpaid rent is backed by the contract's own payment records.");
    if (claimed === BigInt(0)) return entry("none", BigInt(0), "Nothing claimed.");
    const it = byIndex.get(item);
    if (!it?.findingId) return entry("landlord-added", BigInt(0), "Added by the landlord; no AI finding supports it.");
    const f = findings.get(it.findingId);
    if (!f) return entry(it.findingId, BigInt(0), "The referenced finding is not in the move-out report.");
    confidences.push(f.confidence);
    if (!f.deductible) return entry(f.findingId, BigInt(0), `Not deductible (${f.change.replace("_", " ")}).`);
    if (f.confidence < MIN_CONFIDENCE) return entry(f.findingId, BigInt(0), `AI confidence ${f.confidence} is below ${MIN_CONFIDENCE}.`);
    if (args.taintedVantages.has(f.vantageId)) return entry(f.findingId, BigInt(0), "The move-out photo failed integrity checks (reused or not fresh).");
    return entry(f.findingId, inrToWei(f.estimatedCostINR), `${f.description} Estimated ₹${f.estimatedCostINR} from the sample rate card.`);
  });

  const mean = confidences.length ? confidences.reduce((a, b) => a + b, 0) / confidences.length : 0;
  return {
    supported: mapping.map((m) => BigInt(m.supportedWei)),
    score: Math.min(100, Math.max(0, Math.round(mean * 100))),
    mapping,
  };
}
