// Appendix B.6 invoice doc + extraction, B.7 invoice report.
import { z } from "zod";
import { address, confidence, hex32, isoDate, isoDateTime, score100, weiString } from "./common";

export const InvoiceCategory = z.enum([
  "plumbing", "electrical", "cleaning", "security", "water", "lift", "garden", "painting", "civil", "other",
]);

export const InvoiceDocSchema = z.object({
  schema: z.literal("nestledger.invoice.v1"),
  createdAt: isoDateTime,
  societyId: z.string(),
  payee: address,
  declaredAmountWei: weiString,
  declaredAmountINR: z.number().nonnegative(),
  category: InvoiceCategory,
  files: z.array(hex32).min(1),
  note: z.string().optional(),
});

/** Not a manifest on its own (no `schema` field); embedded in InvoiceReport. */
export const InvoiceExtractionSchema = z.object({
  vendorName: z.string(),
  vendorGSTIN: z.string().nullable(),
  invoiceNumber: z.string(),
  invoiceDate: isoDate,
  lineItems: z.array(
    z.object({
      description: z.string(),
      quantity: z.number().nonnegative(),
      unitPriceINR: z.number().nonnegative(),
      amountINR: z.number().nonnegative(),
    }),
  ),
  subtotalINR: z.number().nonnegative(),
  taxINR: z.number().nonnegative(),
  totalINR: z.number().nonnegative(),
  category: InvoiceCategory,
  confidence,
});

export const InvoiceRuleId = z.enum(["R1", "R2", "R3", "R4", "R5", "R6", "R7"]);

export const InvoiceReportSchema = z.object({
  schema: z.literal("nestledger.report.invoice.v1"),
  createdAt: isoDateTime,
  model: z.string(),
  promptVersion: z.string(),
  societyId: z.string(),
  proposalId: z.string().optional(),
  docHash: hex32,
  extraction: InvoiceExtractionSchema,
  checks: z.array(
    z.object({
      ruleId: InvoiceRuleId,
      passed: z.boolean(),
      severity: z.enum(["info", "low", "medium", "high"]),
      facts: z.record(z.union([z.string(), z.number()])),
    }),
  ),
  riskScore: score100,
  flagged: z.boolean(),
  justification: z.string(),
});

export type InvoiceCategory = z.infer<typeof InvoiceCategory>;
export type InvoiceDoc = z.infer<typeof InvoiceDocSchema>;
export type InvoiceExtraction = z.infer<typeof InvoiceExtractionSchema>;
export type InvoiceReport = z.infer<typeof InvoiceReportSchema>;
