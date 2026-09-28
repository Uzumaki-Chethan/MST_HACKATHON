// Task 3 instruction (SPEC §6.3). The system prompt is prompts/system.ts.
import type { MilestoneSpec } from "@nestledger/shared/schemas";

export function milestoneInstruction(spec: MilestoneSpec, labels: string[], notes: string[]): string {
  const items = spec.lineItems.map(({ index, description, acceptance }) => ({ index, description, acceptance }));
  return `TASK: renovation milestone check: "${spec.title}".

Photos come in pairs: "[ref/<vantageId>]" is the agreed reference or design image, "[site/<vantageId>]" is the
contractor's photo of the finished work from the same angle. Photo labels: ${labels.join(", ")}.
Vantage points: ${JSON.stringify(spec.vantagePoints.map(({ id, description }) => ({ id, description })))}

Line items to check (index, description, acceptance criteria):
${JSON.stringify(items)}
Checklist: ${JSON.stringify(spec.checklist)}

For every line item decide:
- "complete": every acceptance criterion is visibly met.
- "partial": some of it is done; give supportedFraction between 0 and 0.9 for how much is visibly done.
- "not_done": the work is not visible.
- "cannot_verify": the photos cannot show it (hidden work, wiring inside walls, structural safety). Never guess these.
List discrepancies against the reference (wrong material or colour, missing fixture, unfinished edges) with severity "minor" or "major".
Evaluate each checklist item as "pass", "fail" or "unclear".
Give an overall matchScore from 0 to 100 and a confidence from 0 to 1. Do not judge structural safety or hidden work.
${notes.length ? `\nEvidence integrity notes:\n${notes.map((n) => `- ${n}`).join("\n")}\n` : ""}
Return this JSON shape:
{
  "lineItems": [{ "index": number, "status": "complete" | "partial" | "not_done" | "cannot_verify",
    "supportedFraction": number, "evidence": string,
    "discrepancies": [{ "description": string, "severity": "minor" | "major", "photoRef"?: string }] }],
  "checklist": [{ "itemId": string, "result": "pass" | "fail" | "unclear", "note": string }],
  "matchScore": number, "summary": string, "confidence": number
}`;
}
