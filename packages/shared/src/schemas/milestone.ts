// Appendix B.5 — project spec, milestone spec, milestone claim, milestone report.
import { z } from "zod";
import { confidence, hex32, isoDateTime, score100, weiString } from "./common";

export const ProjectSpecSchema = z.object({
  schema: z.literal("nestledger.project-spec.v1"),
  createdAt: isoDateTime,
  title: z.string(),
  scope: z.string(),
  siteLabel: z.string().optional(),
  location: z.object({ lat: z.number(), lng: z.number() }).optional(),
  warrantyDays: z.number().nonnegative().optional(),
  milestoneSpecHashes: z.array(hex32),
});

export const MilestoneSpecSchema = z.object({
  schema: z.literal("nestledger.milestone-spec.v1"),
  createdAt: isoDateTime,
  title: z.string(),
  lineItems: z
    .array(
      z.object({
        index: z.number().int().min(0),
        description: z.string(),
        amountWei: weiString,
        amountINR: z.number().nonnegative(),
        acceptance: z.array(z.string()),
      }),
    )
    .min(1)
    .max(10),
  checklist: z.array(z.object({ itemId: z.string(), text: z.string() })),
  vantagePoints: z.array(z.object({ id: z.string(), description: z.string(), referenceImageHash: hex32.optional() })),
  designRefs: z.array(hex32),
});

export const MilestoneClaimSchema = z.object({
  schema: z.literal("nestledger.claim.milestone.v1"),
  createdAt: isoDateTime,
  projectId: z.string(),
  milestoneIndex: z.number().int().min(0),
  round: z.number().int().min(0),
  photosBundleHash: hex32,
  previewReportHash: hex32.optional(),
  lineItems: z.array(z.object({ index: z.number().int().min(0), claimedWei: weiString, note: z.string().optional() })),
});

export const MilestoneLineStatus = z.enum(["complete", "partial", "not_done", "cannot_verify"]);

export const MilestoneReportSchema = z.object({
  schema: z.literal("nestledger.report.milestone.v1"),
  createdAt: isoDateTime,
  model: z.string(),
  promptVersion: z.string(),
  projectId: z.string(),
  milestoneIndex: z.number().int().min(0),
  specHash: hex32,
  photosBundleHash: hex32,
  lineItems: z.array(
    z.object({
      index: z.number().int().min(0),
      status: MilestoneLineStatus,
      supportedFraction: z.number().min(0).max(1),
      evidence: z.string(),
      discrepancies: z.array(
        z.object({ description: z.string(), severity: z.enum(["minor", "major"]), photoRef: z.string().optional() }),
      ),
    }),
  ),
  checklist: z.array(z.object({ itemId: z.string(), result: z.enum(["pass", "fail", "unclear"]), note: z.string() })),
  matchScore: score100,
  scoreUsed: score100,
  summary: z.string(),
  confidence,
});

export type ProjectSpec = z.infer<typeof ProjectSpecSchema>;
export type MilestoneSpec = z.infer<typeof MilestoneSpecSchema>;
export type MilestoneClaim = z.infer<typeof MilestoneClaimSchema>;
export type MilestoneReport = z.infer<typeof MilestoneReportSchema>;
