// Appendix B.3 move-in report, B.4 move-out report.
import { z } from "zod";
import { confidence, hex32, isoDateTime, quantity1000 } from "./common";

export const MoveInElementSchema = z.object({
  elementId: z.string(),
  element: z.string(),
  condition: z.enum(["good", "minor_wear", "damaged", "missing", "not_visible"]),
  notes: z.string(),
  photoRefs: z.array(z.string()),
});

export const MoveInReportSchema = z.object({
  schema: z.literal("nestledger.report.move-in.v1"),
  createdAt: isoDateTime,
  model: z.string(),
  promptVersion: z.string(),
  leaseId: z.string(),
  bundleHash: hex32,
  rooms: z.array(
    z.object({ room: z.string(), vantageIds: z.array(z.string()), elements: z.array(MoveInElementSchema) }),
  ),
  overallCondition: z.enum(["excellent", "good", "fair", "poor"]),
  summary: z.string(),
  confidence,
});

export const MoveOutChange = z.enum([
  "none", "normal_wear", "new_damage", "missing_item", "cleaning_required", "cannot_compare",
]);

export const MoveOutFindingSchema = z.object({
  findingId: z.string(),
  room: z.string(),
  elementId: z.string(),
  vantageId: z.string(),
  change: MoveOutChange,
  severity: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  description: z.string(),
  beforePhotoRef: z.string(),
  afterPhotoRef: z.string(),
  rateItemId: z.string().optional(),
  quantity: quantity1000.optional(),
  estimatedCostINR: z.number().nonnegative(),
  deductible: z.boolean(),
  confidence,
});

export const MoveOutReportSchema = z.object({
  schema: z.literal("nestledger.report.move-out.v1"),
  createdAt: isoDateTime,
  model: z.string(),
  promptVersion: z.string(),
  leaseId: z.string(),
  baselineReportHash: hex32,
  baselineStatus: z.enum(["Agreed", "PresumedAccepted", "Contested"]),
  moveOutBundleHash: hex32,
  findings: z.array(MoveOutFindingSchema),
  unpairedVantages: z.array(z.string()),
  summary: z.string(),
  totals: z.object({ deductibleINR: z.number().nonnegative(), findings: z.number().int().nonnegative() }),
});

export type MoveInElement = z.infer<typeof MoveInElementSchema>;
export type MoveInReport = z.infer<typeof MoveInReportSchema>;
export type MoveOutFinding = z.infer<typeof MoveOutFindingSchema>;
export type MoveOutReport = z.infer<typeof MoveOutReportSchema>;
