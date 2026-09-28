// Appendix B.8 — note, profile, society meta, attestation report.
import { z } from "zod";
import { hex32, isoDateTime, score100, weiString } from "./common";

export const NoteSchema = z.object({
  schema: z.literal("nestledger.note.v1"),
  createdAt: isoDateTime,
  purpose: z.enum(["override", "rework", "rationale", "change-order", "contest"]),
  text: z.string().min(1),
  refs: z.array(z.string()).optional(),
});

// strict(): no phone, email or ID numbers may ride along in a profile.
export const ProfileMetaSchema = z
  .object({
    schema: z.literal("nestledger.profile.v1"),
    createdAt: isoDateTime,
    displayName: z.string().max(64).optional(),
    kinds: z.array(z.string()),
  })
  .strict();

export const SocietyMetaSchema = z.object({
  schema: z.literal("nestledger.society.v1"),
  createdAt: isoDateTime,
  displayName: z.string(),
  city: z.string(),
  location: z.object({ lat: z.number(), lng: z.number() }),
  rulesText: z.string().optional(),
});

export const AttestationReportSchema = z.object({
  schema: z.literal("nestledger.report.attestation.v1"),
  createdAt: isoDateTime,
  contract: z.enum(["RentalEscrow", "MilestoneEscrow"]),
  agreementId: z.string(),
  trancheIdx: z.number().int().min(0),
  round: z.number().int().min(0),
  sourceReportHash: hex32,
  claimManifestHash: hex32,
  mapping: z.array(
    z.object({ item: z.number().int().min(0), ref: z.string(), supportedWei: weiString, reason: z.string() }),
  ),
  score: score100,
  model: z.string(),
  promptVersion: z.string(),
});

export type Note = z.infer<typeof NoteSchema>;
export type ProfileMeta = z.infer<typeof ProfileMetaSchema>;
export type SocietyMeta = z.infer<typeof SocietyMetaSchema>;
export type AttestationReport = z.infer<typeof AttestationReportSchema>;
