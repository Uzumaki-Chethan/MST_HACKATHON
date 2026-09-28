// Task 2 instruction (SPEC §6.3). The system prompt is prompts/system.ts.
import type { MoveInReport } from "@nestledger/shared/schemas";

export type RateItem = { id: string; description: string; unit: string; rateINR: number };

export function moveOutInstruction(args: {
  baseline: MoveInReport;
  baselineStatus: "Agreed" | "PresumedAccepted" | "Contested";
  pairs: string[];
  rateCard: RateItem[];
  notes: string[];
}): string {
  const baselineRooms = args.baseline.rooms.map((r) => ({
    room: r.room,
    elements: r.elements.map((e) => ({ elementId: e.elementId, condition: e.condition, notes: e.notes })),
  }));
  return `TASK: move-out comparison for a rented flat.

Photos come in pairs labelled "[<vantageId>-before]" (move-in) and "[<vantageId>-after]" (move-out).
Photos labelled "[counter/<vantageId>]" are the landlord's counter-evidence from move-in.
Vantages in this batch: ${args.pairs.join(", ")}.

Move-in baseline (status: ${args.baselineStatus}):
${JSON.stringify(baselineRooms)}
${args.baselineStatus === "Contested" ? "\nThe baseline is CONTESTED: the landlord disputed it. Keep every confidence at 0.5 or lower.\n" : ""}
For each pair, compare before and after for each element and classify the change:
- "none": no visible change.
- "normal_wear": faded paint, minor scuffs from normal living, small nail holes. This is NEVER deductible.
- "new_damage": damage not present at move-in.
- "missing_item": something present at move-in is gone.
- "cleaning_required": the flat needs more than normal cleaning.
- "cannot_compare": angle or lighting too different to judge.

For new_damage, missing_item and cleaning_required, choose exactly ONE rate-card item id and a quantity.
Do not state any rupee amount; the system computes cost from the rate card. Rate card:
${JSON.stringify(args.rateCard.map(({ id, description, unit }) => ({ id, description, unit })))}
Explain each finding in one sentence. Give a confidence from 0 to 1.
${args.notes.length ? `\nEvidence integrity notes:\n${args.notes.map((n) => `- ${n}`).join("\n")}\n` : ""}
Return this JSON shape:
{
  "findings": [{ "findingId": string, "room": string, "elementId": string, "vantageId": string,
    "change": "none" | "normal_wear" | "new_damage" | "missing_item" | "cleaning_required" | "cannot_compare",
    "severity": 1 | 2 | 3 | 4 | 5, "description": string,
    "beforePhotoRef": string, "afterPhotoRef": string,
    "rateItemId"?: string, "quantity"?: number, "confidence": number }],
  "summary": string
}`;
}
