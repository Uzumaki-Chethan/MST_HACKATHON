// Task 1 instruction (SPEC §6.3). The system prompt is prompts/system.ts.
export const ROOM_CHECKLIST = [
  "walls", "ceiling", "floor", "doors and frames", "windows and glass", "switches and sockets",
  "light fixtures", "taps and sanitary fittings", "cabinets and wardrobes", "appliances", "curtain rods",
];

export function moveInInstruction(labels: string[]): string {
  return `TASK: move-in condition report for a rented flat.

The photos above are labelled "[room/vantageId]". Photo labels: ${labels.join(", ")}.
For every room, document the condition of every visible element. Use this checklist where the element is in frame:
${ROOM_CHECKLIST.map((c) => `- ${c}`).join("\n")}

Rules:
- Record every existing mark, crack, stain, chip, scuff or missing part, with where it is ("left wall near the switchboard").
- Do not judge who caused anything. Only describe the state.
- If an element on the checklist is not visible in any photo, either omit it or mark it "not_visible". Never guess.
- photoRefs are the photo labels (e.g. "kitchen/kitchen-counter") where the element is visible.
- elementId is "<room>.<element>" in lower case, e.g. "kitchen.counter".

Return this JSON shape:
{
  "rooms": [{ "room": string, "vantageIds": string[],
    "elements": [{ "elementId": string, "element": string,
      "condition": "good" | "minor_wear" | "damaged" | "missing" | "not_visible",
      "notes": string, "photoRefs": string[] }] }],
  "overallCondition": "excellent" | "good" | "fair" | "poor",
  "summary": string,          // 2-3 sentences
  "confidence": number        // 0..1, how clearly the photos show the flat
}`;
}
