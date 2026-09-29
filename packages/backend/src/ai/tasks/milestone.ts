// SPEC §6.3 Task 3 — milestone check. An AI check, not an AI judge: code sets every fraction and the score.
import fs from "node:fs";
import { z } from "zod";
import {
  MilestoneLineStatus,
  MilestoneReportSchema,
  MilestoneSpecSchema,
  type MilestoneReport,
} from "@nestledger/shared/schemas";
import type { Hex32 } from "@nestledger/shared";
import {
  clamp,
  findReport,
  integrityNote,
  llmConfidence,
  llmScore,
  loadBundle,
  loadManifest,
  loadPhotos,
  NotFoundError,
  storeReport,
  type AiDeps,
} from "../common.js";
import { demoUploads, isTainted } from "../integrity.js";
import { prepareImage, PROMPT_VERSION, type LLMImage } from "../llm.js";
import { readMilestone } from "../onchain.js";
import { SYSTEM_PROMPT } from "../prompts/system.js";
import { milestoneInstruction } from "../prompts/milestone.js";

export const MIN_CONFIDENCE = 0.6;
const MAX_VANTAGES = 8; // ref + site per vantage = 16 images, the per-call limit

const LlmMilestone = z.object({
  lineItems: z.array(
    z.object({
      index: z.number().int().min(0),
      status: MilestoneLineStatus,
      supportedFraction: clamp(0, 1),
      evidence: z.string(),
      discrepancies: z.array(z.object({ description: z.string(), severity: z.enum(["minor", "major"]), photoRef: z.string().optional() })),
    }),
  ),
  checklist: z.array(z.object({ itemId: z.string(), result: z.enum(["pass", "fail", "unclear"]), note: z.string() })),
  matchScore: llmScore,
  summary: z.string(),
  confidence: llmConfidence,
});
type LlmMilestone = z.infer<typeof LlmMilestone>;

/**
 * Code rules (SPEC §6.3): complete → 1.0, partial → clamped to 0–0.9, anything else → 0.
 * Confidence below 0.6 zeroes every fraction and caps the score at 50, so silence can't release on a weak read.
 */
export function applyMilestoneRules(out: LlmMilestone, lineCount: number) {
  const weak = out.confidence < MIN_CONFIDENCE;
  const byIndex = new Map(out.lineItems.map((l) => [l.index, l]));
  const lineItems = Array.from({ length: lineCount }, (_, index) => {
    const l = byIndex.get(index) ?? { index, status: "cannot_verify" as const, supportedFraction: 0, evidence: "Not assessed.", discrepancies: [] };
    const fraction = weak ? 0 : l.status === "complete" ? 1 : l.status === "partial" ? Math.min(0.9, l.supportedFraction) : 0;
    return { ...l, supportedFraction: fraction };
  });
  const matchScore = Math.round(out.matchScore);
  return { lineItems, matchScore, scoreUsed: weak ? Math.min(matchScore, 50) : matchScore };
}

/** supported[i] = cap[i] × fraction[i], floored in basis points (bigint maths). Tainted photos → all zero (SPEC §6.5). */
export function milestoneSupport(report: MilestoneReport, caps: bigint[], tainted: boolean): bigint[] {
  return caps.map((cap, i) => {
    if (tainted) return BigInt(0);
    const f = report.lineItems.find((l) => l.index === i)?.supportedFraction ?? 0;
    return (cap * BigInt(Math.floor(f * 10_000))) / BigInt(10_000);
  });
}

/** Why the photo set earns no AI support (SPEC §6.5), in plain words; empty when every photo passes. */
export function integrityIssues(deps: Pick<AiDeps, "db">, bundleHash: string): string[] {
  try {
    return loadPhotos(deps.db, loadBundle(deps.db, bundleHash))
      .filter((p) => isTainted(p.checks))
      .map((p) => {
        const c = p.checks!;
        const why = [
          c.reusedOf && "looks reused from earlier evidence",
          c.fresh === false && "was not captured live within 5 minutes of upload",
          c.stale && !demoUploads() && "has a missing or old photo time",
          c.duplicateOf && "is an exact copy of an earlier upload",
        ].filter(Boolean).join(", ");
        return `Photo ${p.item.vantageId ?? p.item.hash.slice(0, 10)} ${why}.`;
      });
  } catch {
    return ["The photo set could not be checked."];
  }
}

export async function runMilestonePreview(
  args: { projectId: string; milestoneIndex: number; bundleHash: string },
  deps: AiDeps,
): Promise<{ report: MilestoneReport; reportHash: Hex32; supportedPreview: string[]; integrity: string[] }> {
  const onchain = await readMilestone(args.projectId, args.milestoneIndex, deps);
  const integrity = integrityIssues(deps, args.bundleHash);
  const tainted = integrity.length > 0;
  const existing = findReport<MilestoneReport>(deps.db, "milestone", args.projectId, "photosBundleHash", args.bundleHash);
  if (existing && existing.report.milestoneIndex === args.milestoneIndex && existing.report.specHash === onchain.specHash) {
    return { ...existing, supportedPreview: milestoneSupport(existing.report, onchain.itemCaps, tainted).map(String), integrity };
  }

  const spec = loadManifest(deps.db, onchain.specHash, MilestoneSpecSchema, "Milestone spec");
  const site = new Map(loadPhotos(deps.db, loadBundle(deps.db, args.bundleHash)).map((p) => [p.item.vantageId ?? p.item.hash, p]));

  const images: LLMImage[] = [];
  const labels: string[] = [];
  const notes: string[] = [];
  for (const vp of spec.vantagePoints.slice(0, MAX_VANTAGES)) {
    if (vp.referenceImageHash) {
      const row = deps.db.get<{ path: string }>("SELECT path FROM evidence WHERE hash = ?", [vp.referenceImageHash]);
      if (row) {
        images.push(await prepareImage(`ref/${vp.id}`, fs.readFileSync(row.path)));
        labels.push(`ref/${vp.id}`);
      }
    }
    const s = site.get(vp.id);
    if (s) {
      images.push(await prepareImage(`site/${vp.id}`, s.data));
      labels.push(`site/${vp.id}`);
      const n = integrityNote(`site/${vp.id}`, s.checks);
      if (n) notes.push(n);
    }
  }
  if (!labels.some((l) => l.startsWith("site/"))) throw new NotFoundError("No site photos match the milestone's vantage points");

  const { output } = await deps.llm.analyze({
    system: SYSTEM_PROMPT,
    instruction: milestoneInstruction(spec, labels, notes),
    images,
    schema: LlmMilestone,
    task: "milestone",
  });
  const ruled = applyMilestoneRules(output, spec.lineItems.length);

  const report = MilestoneReportSchema.parse({
    schema: "nestledger.report.milestone.v1",
    createdAt: new Date().toISOString(),
    model: deps.llm.id,
    promptVersion: PROMPT_VERSION,
    projectId: args.projectId,
    milestoneIndex: args.milestoneIndex,
    specHash: onchain.specHash,
    photosBundleHash: args.bundleHash,
    lineItems: ruled.lineItems,
    checklist: output.checklist,
    matchScore: ruled.matchScore,
    scoreUsed: ruled.scoreUsed,
    summary: output.summary,
    confidence: output.confidence,
  });
  const reportHash = storeReport(deps.db, { task: "milestone", report, contextType: "project", contextId: args.projectId });
  return { report, reportHash, supportedPreview: milestoneSupport(report, onchain.itemCaps, tainted).map(String), integrity };
}
