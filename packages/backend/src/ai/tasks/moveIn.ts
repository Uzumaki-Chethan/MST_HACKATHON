// SPEC §6.3 Task 1 — move-in condition report.
import { z } from "zod";
import { MoveInElementSchema, MoveInReportSchema, type MoveInReport } from "@nestledger/shared/schemas";
import type { Hex32 } from "@nestledger/shared";
import { chunk, findReport, integrityNote, llmConfidence, loadBundle, loadPhotos, storeReport, type AiDeps } from "../common.js";
import { prepareImage, PROMPT_VERSION } from "../llm.js";
import { SYSTEM_PROMPT } from "../prompts/system.js";
import { moveInInstruction } from "../prompts/moveIn.js";

const LlmMoveIn = z.object({
  rooms: z.array(z.object({ room: z.string(), vantageIds: z.array(z.string()), elements: z.array(MoveInElementSchema) })),
  overallCondition: z.enum(["excellent", "good", "fair", "poor"]),
  summary: z.string(),
  confidence: llmConfidence,
});

const WORST: MoveInReport["overallCondition"][] = ["excellent", "good", "fair", "poor"];

export async function runMoveIn(
  args: { leaseId: string; bundleHash: string },
  deps: AiDeps,
): Promise<{ report: MoveInReport; reportHash: Hex32 }> {
  const existing = findReport<MoveInReport>(deps.db, "moveIn", args.leaseId, "bundleHash", args.bundleHash);
  if (existing) return existing;

  const photos = loadPhotos(deps.db, loadBundle(deps.db, args.bundleHash));
  const label = (p: (typeof photos)[number]) => `${p.item.room ?? "room"}/${p.item.vantageId ?? p.item.hash.slice(2, 10)}`;

  // ≤16 images per call; larger inspections are batched and merged (SPEC §6.2).
  const parts: z.infer<typeof LlmMoveIn>[] = [];
  for (const batch of chunk(photos, 16)) {
    const images = await Promise.all(batch.map((p) => prepareImage(label(p), p.data)));
    const notes = batch.map((p) => integrityNote(label(p), p.checks)).filter((n): n is string => !!n);
    const instruction = moveInInstruction(batch.map(label)) + (notes.length ? `\n\nEvidence integrity notes:\n${notes.join("\n")}` : "");
    const { output } = await deps.llm.analyze({ system: SYSTEM_PROMPT, instruction, images, schema: LlmMoveIn, task: "moveIn" });
    parts.push(output);
  }

  const report = MoveInReportSchema.parse({
    schema: "nestledger.report.move-in.v1",
    createdAt: new Date().toISOString(),
    model: deps.llm.id,
    promptVersion: PROMPT_VERSION,
    leaseId: args.leaseId,
    bundleHash: args.bundleHash,
    rooms: parts.flatMap((p) => p.rooms),
    overallCondition: parts.map((p) => p.overallCondition).sort((a, b) => WORST.indexOf(b) - WORST.indexOf(a))[0] ?? "good",
    summary: parts.map((p) => p.summary).join(" "),
    confidence: Math.min(...parts.map((p) => p.confidence), 1),
  });
  const reportHash = storeReport(deps.db, { task: "moveIn", report, contextType: "lease", contextId: args.leaseId });
  return { report, reportHash };
}
