// SPEC §6.3 Task 2 — move-out comparison. The LLM classifies; code computes every rupee.
import { z } from "zod";
import {
  MoveInReportSchema,
  MoveOutChange,
  MoveOutReportSchema,
  type MoveInReport,
  type MoveOutFinding,
  type MoveOutReport,
} from "@nestledger/shared/schemas";
import type { Hex32 } from "@nestledger/shared";
import {
  chunk,
  clamp,
  findReport,
  integrityNote,
  llmConfidence,
  llmQuantity,
  loadBundle,
  loadPhotos,
  NotFoundError,
  storeReport,
  type AiDeps,
  type LoadedPhoto,
} from "../common.js";
import { prepareImage, PROMPT_VERSION, type LLMImage } from "../llm.js";
import { readLeaseBaseline } from "../lease.js";
import { SYSTEM_PROMPT } from "../prompts/system.js";
import { moveOutInstruction, type RateItem } from "../prompts/moveOut.js";
import rateCardJson from "../ratecard.json" with { type: "json" };

export const RATE_CARD: RateItem[] = rateCardJson.items;
const RATES = new Map(RATE_CARD.map((r) => [r.id, r.rateINR]));
const DEDUCTIBLE = new Set(["new_damage", "missing_item", "cleaning_required"]);
const PAIRS_PER_CALL = 5; // before + after + optional counter photo = at most 15 images

const LlmFinding = z.object({
  findingId: z.string(),
  room: z.string(),
  elementId: z.string(),
  vantageId: z.string(),
  change: MoveOutChange,
  severity: clamp(1, 5).transform((v): 1 | 2 | 3 | 4 | 5 => Math.round(v) as 1 | 2 | 3 | 4 | 5),
  description: z.string(),
  beforePhotoRef: z.string(),
  afterPhotoRef: z.string(),
  rateItemId: z.string().optional(),
  quantity: llmQuantity.optional(),
  confidence: llmConfidence,
});
const LlmMoveOut = z.object({ findings: z.array(LlmFinding), summary: z.string() });

/** Code-side cost rules (SPEC §6.3): only deductible changes with a known rate-card id cost anything. */
export function priceFinding(f: z.infer<typeof LlmFinding>, contested: boolean): MoveOutFinding {
  const rate = f.rateItemId ? RATES.get(f.rateItemId) : undefined;
  const qty = f.quantity ?? 0;
  const deductible = DEDUCTIBLE.has(f.change) && rate !== undefined && qty > 0;
  return {
    ...f,
    confidence: contested ? Math.min(f.confidence, 0.5) : f.confidence,
    deductible,
    estimatedCostINR: deductible ? Math.round(rate! * qty) : 0,
  };
}

export async function runMoveOut(
  args: { leaseId: string; bundleHash: string },
  deps: AiDeps,
): Promise<{ report: MoveOutReport; reportHash: Hex32 }> {
  const existing = findReport<MoveOutReport>(deps.db, "moveOut", args.leaseId, "moveOutBundleHash", args.bundleHash);
  if (existing) return existing;

  const lease = await readLeaseBaseline(args.leaseId, deps);
  const baselineRow = deps.db.get<{ json: string }>("SELECT json FROM reports WHERE hash = ?", [lease.baselineReportHash]);
  if (!baselineRow) throw new NotFoundError(`Baseline report ${lease.baselineReportHash} not found`);
  const baseline: MoveInReport = MoveInReportSchema.parse(JSON.parse(baselineRow.json));

  const byVantage = (photos: LoadedPhoto[]) => new Map(photos.map((p) => [p.item.vantageId ?? p.item.hash, p]));
  const before = byVantage(loadPhotos(deps.db, loadBundle(deps.db, baseline.bundleHash)));
  const after = byVantage(loadPhotos(deps.db, loadBundle(deps.db, args.bundleHash)));
  const counter = lease.counterEvidence ? byVantage(loadPhotos(deps.db, loadBundle(deps.db, lease.counterEvidence))) : new Map();

  const paired = [...after.keys()].filter((v) => before.has(v));
  const unpairedVantages = [
    ...[...after.keys()].filter((v) => !before.has(v)),
    ...[...before.keys()].filter((v) => !after.has(v)),
  ];
  const contested = lease.status === "Contested";

  const findings: MoveOutFinding[] = [];
  const summaries: string[] = [];
  for (const batch of chunk(paired, PAIRS_PER_CALL)) {
    const images: LLMImage[] = [];
    const notes: string[] = [];
    for (const v of batch) {
      const b = before.get(v)!, a = after.get(v)!, c = counter.get(v);
      images.push(await prepareImage(`${v}-before`, b.data), await prepareImage(`${v}-after`, a.data));
      if (c) images.push(await prepareImage(`counter/${v}`, c.data));
      const note = integrityNote(`${v}-after`, a.checks);
      if (note) notes.push(note);
    }
    const instruction = moveOutInstruction({ baseline, baselineStatus: lease.status, pairs: batch, rateCard: RATE_CARD, notes });
    const { output } = await deps.llm.analyze({ system: SYSTEM_PROMPT, instruction, images, schema: LlmMoveOut, task: "moveOut" });
    findings.push(...output.findings.map((f) => priceFinding(f, contested)));
    summaries.push(output.summary);
  }
  // Batches each number their own findings; make the ids unique for the claim builder and the attestor.
  findings.forEach((f, i) => (f.findingId = `f${i + 1}`));

  const report = MoveOutReportSchema.parse({
    schema: "nestledger.report.move-out.v1",
    createdAt: new Date().toISOString(),
    model: deps.llm.id,
    promptVersion: PROMPT_VERSION,
    leaseId: args.leaseId,
    baselineReportHash: lease.baselineReportHash,
    baselineStatus: lease.status,
    moveOutBundleHash: args.bundleHash,
    findings,
    unpairedVantages,
    summary: summaries.join(" ") || "No move-out photos matched a move-in vantage point.",
    totals: { deductibleINR: findings.reduce((s, f) => s + f.estimatedCostINR, 0), findings: findings.length },
  });
  const reportHash = storeReport(deps.db, { task: "moveOut", report, contextType: "lease", contextId: args.leaseId });
  return { report, reportHash };
}
