// Appendix B.2 — lease terms and rental claim.
import { z } from "zod";
import { hex32, isoDateTime, weiString } from "./common";

export const LeaseTermsSchema = z.object({
  schema: z.literal("nestledger.lease-terms.v1"),
  createdAt: isoDateTime,
  flatLabel: z.string().optional(),
  societyId: z.string().optional(),
  address: z.string().optional(),
  rentINR: z.number().nonnegative(),
  maintenanceINR: z.number().nonnegative(),
  depositINR: z.number().nonnegative(),
  depositMonths: z.number().nonnegative(),
  periodDays: z.number().nonnegative(),
  periods: z.number().int().min(1),
  graceDays: z.number().nonnegative(),
  noticeClause: z.string().optional(),
  houseRules: z.array(z.string()).optional(),
  agreementPdfHash: hex32.optional(),
  inspectionTemplate: z.enum(["full", "compact"]),
});

export const RentalClaimItemSchema = z.object({
  index: z.number().int().min(0).max(9),
  type: z.enum(["unpaid_dues", "damage", "missing_item", "cleaning", "other"]),
  findingId: z.string().optional(),
  description: z.string(),
  amountWei: weiString,
  amountINR: z.number().nonnegative(),
});

export const RentalClaimSchema = z
  .object({
    schema: z.literal("nestledger.claim.rental.v1"),
    createdAt: isoDateTime,
    leaseId: z.string(),
    moveOutReportHash: hex32,
    extraEvidence: hex32.optional(),
    items: z.array(RentalClaimItemSchema).min(1).max(10),
  })
  .refine((c) => c.items.every((it, i) => it.index === i), "items[i].index must equal i")
  .refine((c) => c.items[0].type === "unpaid_dues", "item 0 is always unpaid_dues");

export type LeaseTerms = z.infer<typeof LeaseTermsSchema>;
export type RentalClaimItem = z.infer<typeof RentalClaimItemSchema>;
export type RentalClaim = z.infer<typeof RentalClaimSchema>;
