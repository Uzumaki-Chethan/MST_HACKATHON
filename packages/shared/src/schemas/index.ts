// Appendix B zod schemas. Import as "@nestledger/shared/schemas".
import type { ZodTypeAny } from "zod";
import { BundleSchema } from "./bundle";
import { LeaseTermsSchema, RentalClaimSchema } from "./lease";
import { MoveInReportSchema, MoveOutReportSchema } from "./reports";
import { MilestoneClaimSchema, MilestoneReportSchema, MilestoneSpecSchema, ProjectSpecSchema } from "./milestone";
import { InvoiceDocSchema, InvoiceReportSchema } from "./invoice";
import { AttestationReportSchema, NoteSchema, ProfileMetaSchema, SocietyMetaSchema } from "./other";

export * from "./common";
export * from "./bundle";
export * from "./lease";
export * from "./reports";
export * from "./milestone";
export * from "./invoice";
export * from "./other";

/** Every schema-tagged manifest/report, keyed by its `schema` string. */
export const manifestSchemas: Record<string, ZodTypeAny> = {
  "nestledger.bundle.v1": BundleSchema,
  "nestledger.lease-terms.v1": LeaseTermsSchema,
  "nestledger.claim.rental.v1": RentalClaimSchema,
  "nestledger.project-spec.v1": ProjectSpecSchema,
  "nestledger.milestone-spec.v1": MilestoneSpecSchema,
  "nestledger.claim.milestone.v1": MilestoneClaimSchema,
  "nestledger.invoice.v1": InvoiceDocSchema,
  "nestledger.note.v1": NoteSchema,
  "nestledger.profile.v1": ProfileMetaSchema,
  "nestledger.society.v1": SocietyMetaSchema,
  "nestledger.report.move-in.v1": MoveInReportSchema,
  "nestledger.report.move-out.v1": MoveOutReportSchema,
  "nestledger.report.milestone.v1": MilestoneReportSchema,
  "nestledger.report.invoice.v1": InvoiceReportSchema,
  "nestledger.report.attestation.v1": AttestationReportSchema,
};

/** Validates any known manifest. Throws Error for an unknown `schema`, ZodError for a bad shape. */
export function parseManifest(obj: unknown): { schema: string; value: unknown } {
  const schema = (obj as { schema?: unknown } | null)?.schema;
  if (typeof schema !== "string" || !(schema in manifestSchemas)) {
    throw new Error(`unknown manifest schema: ${String(schema)}`);
  }
  return { schema, value: manifestSchemas[schema].parse(obj) };
}
