// Shared building blocks for every Appendix B schema.
import { z } from "zod";

/** 0x + 64 lowercase hex chars: a manifest/file hash. */
export const hex32 = z.string().regex(/^0x[0-9a-f]{64}$/, "expected 0x + 64 lowercase hex chars");

/** An EVM address (checksum casing not enforced here; contracts/viem handle that). */
export const address = z.string().regex(/^0x[a-fA-F0-9]{40}$/, "expected a 0x-prefixed 20-byte address");

/** On-chain amounts are wei as a decimal string (SPEC §4.5, Appendix B header). */
export const weiString = z.string().regex(/^\d+$/, "expected a decimal wei string");

/** createdAt / capturedAt: ISO 8601. Lenient — accepts anything Date can parse. */
export const isoDateTime = z.string().refine((v) => !Number.isNaN(Date.parse(v)), "expected an ISO 8601 date-time");

/** "YYYY-MM-DD", used by InvoiceExtraction.invoiceDate. */
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

/** Clamped per SPEC §6.7: 0..1. */
export const confidence = z.number().min(0).max(1);

/** Clamped per SPEC §6.7: 0..100 (matchScore, riskScore, the on-chain score). */
export const score100 = z.number().min(0).max(100);

/** Clamped per SPEC §6.7: rate-card quantity, 0..1000. */
export const quantity1000 = z.number().min(0).max(1000);
