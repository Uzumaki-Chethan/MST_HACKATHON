// Appendix B.1 — evidence bundle.
import { z } from "zod";
import { address, hex32, isoDateTime } from "./common";

export const BundleItemSchema = z.object({
  hash: hex32,
  kind: z.enum(["photo", "invoice", "design", "document"]),
  mime: z.string(),
  room: z.string().optional(),
  vantageId: z.string().optional(),
  milestoneIndex: z.number().int().min(0).optional(),
  captureMode: z.enum(["live", "upload"]),
  capturedAt: isoDateTime.optional(),
  geo: z.object({ lat: z.number(), lng: z.number(), acc: z.number() }).optional(),
  phash: z.string().optional(),
  checks: z
    .object({
      fresh: z.boolean().optional(),
      reusedOf: z.string().optional(),
      nearDuplicateOf: z.string().optional(),
      geoOk: z.boolean().nullable().optional(),
      stale: z.boolean().optional(),
    })
    .optional(),
});

export const BundleSchema = z.object({
  schema: z.literal("nestledger.bundle.v1"),
  context: z.object({
    type: z.enum(["lease", "project", "proposal", "order", "society"]),
    id: z.string(),
    stage: z.enum(["move-in", "move-out", "baseline-counter", "milestone", "design-ref", "invoice", "claim-extra"]),
  }),
  createdBy: address,
  createdAt: isoDateTime,
  items: z.array(BundleItemSchema),
  note: z.string().optional(),
});

export type BundleItem = z.infer<typeof BundleItemSchema>;
export type Bundle = z.infer<typeof BundleSchema>;
