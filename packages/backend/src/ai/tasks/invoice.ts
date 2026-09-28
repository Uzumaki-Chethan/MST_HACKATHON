// SPEC §6.3 Tasks 4 + 5 — invoice extraction (vision LLM) and anomaly report (code + LLM wording).
import fs from "node:fs";
import { z } from "zod";
import { weiToInr, type Hex32 } from "@nestledger/shared";
import {
  InvoiceDocSchema,
  InvoiceExtractionSchema,
  InvoiceReportSchema,
  type InvoiceReport,
} from "@nestledger/shared/schemas";
import { BadStateError, llmConfidence, NotFoundError, storeReport, type AiDeps } from "../common.js";
import { prepareImage, PROMPT_VERSION, type LLMImage } from "../llm.js";
import { paidInvoices, pendingProposals } from "../history.js";
import { runAnomalyRules, templateJustification } from "../anomaly.js";
import { readSocietyTier1 } from "../onchain.js";
import { SYSTEM_PROMPT } from "../prompts/system.js";

const LlmExtraction = InvoiceExtractionSchema.extend({ confidence: llmConfidence });
const Justification = z.object({ justification: z.string().min(1) });
const IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);

const EXTRACT_INSTRUCTION = `TASK: extract this vendor invoice for a housing society.
Read only what is printed. Numbers are in Indian rupees. If a field is not printed, use null for vendorGSTIN and "" for text fields.
Return this JSON shape:
{ "vendorName": string, "vendorGSTIN": string | null, "invoiceNumber": string, "invoiceDate": "YYYY-MM-DD",
  "lineItems": [{ "description": string, "quantity": number, "unitPriceINR": number, "amountINR": number }],
  "subtotalINR": number, "taxINR": number, "totalINR": number,
  "category": "plumbing" | "electrical" | "cleaning" | "security" | "water" | "lift" | "garden" | "painting" | "civil" | "other",
  "confidence": number }`;

export async function runInvoicePreview(
  args: { societyId: string; bundleHash: string; payee: string; amountWei: string; proposalId?: string },
  deps: AiDeps,
): Promise<{ report: InvoiceReport; reportHash: Hex32 }> {
  const docRow = deps.db.get<{ json: string }>("SELECT json FROM manifests WHERE hash = ?", [args.bundleHash.toLowerCase()]);
  if (!docRow) throw new NotFoundError(`Invoice ${args.bundleHash} not found`);
  const doc = InvoiceDocSchema.parse(JSON.parse(docRow.json));

  const images: LLMImage[] = [];
  const phashes: string[] = [];
  for (const [i, hash] of doc.files.entries()) {
    const row = deps.db.get<{ path: string; mime: string; phash: string | null }>("SELECT path, mime, phash FROM evidence WHERE hash = ?", [hash]);
    if (!row) throw new NotFoundError(`Invoice file ${hash} not found`);
    if (row.phash) phashes.push(row.phash);
    if (IMAGE_MIMES.has(row.mime) && images.length < 16) images.push(await prepareImage(`invoice-page-${i + 1}`, fs.readFileSync(row.path)));
  }
  if (!images.length) throw new BadStateError("Upload the invoice as a photo or image; PDF invoices aren't read yet");

  const proposedINR = weiToInr(BigInt(args.amountWei));
  const { output: extraction } = await deps.llm.analyze({
    system: SYSTEM_PROMPT,
    instruction: EXTRACT_INSTRUCTION,
    images,
    schema: LlmExtraction,
    task: `invoiceExtract@${Math.round(proposedINR)}`,
  });

  const now = Math.floor(Date.now() / 1000);
  const tier1LimitINR = weiToInr(await readSocietyTier1(args.societyId, deps));
  const others = <T extends { proposalId: string }>(xs: T[]) => xs.filter((x) => x.proposalId !== args.proposalId);
  const { checks, riskScore, flagged } = runAnomalyRules({
    extraction,
    payee: args.payee,
    category: doc.category,
    proposedINR,
    fileHashes: doc.files,
    phashes,
    tier1LimitINR,
    paid: others(paidInvoices(deps.db, args.societyId, now - 180 * 86_400)),
    pending: others(pendingProposals(deps.db, args.societyId, args.payee)),
    now,
  });

  let justification = templateJustification(checks);
  if (flagged && deps.llm.id !== "fixtures") {
    try {
      const facts = checks.filter((c) => !c.passed).map(({ ruleId, severity, facts }) => ({ ruleId, severity, facts }));
      const { output } = await deps.llm.analyze({
        system: "You write short, neutral notes for a housing society committee.",
        instruction: `Write 1-3 sentences for a housing society committee explaining the flags below. Use only these facts and quote the numbers. Do not speculate about fraud or intent. Amounts are in Indian rupees.\nFlags: ${JSON.stringify(facts)}\nReturn { "justification": string }.`,
        images: [],
        schema: Justification,
        task: "invoiceJustification",
      });
      justification = output.justification;
    } catch {
      // keep the template built from the same facts (SPEC §6.3)
    }
  }

  const report = InvoiceReportSchema.parse({
    schema: "nestledger.report.invoice.v1",
    createdAt: new Date().toISOString(),
    model: deps.llm.id,
    promptVersion: PROMPT_VERSION,
    societyId: args.societyId,
    ...(args.proposalId ? { proposalId: args.proposalId } : {}),
    docHash: args.bundleHash.toLowerCase(),
    extraction,
    checks,
    riskScore,
    flagged,
    justification,
  });
  // Society invoices are public on purpose (SPEC §2.1 principle 9).
  const reportHash = storeReport(deps.db, { task: "invoice", report, contextType: "society", contextId: args.societyId, isPublic: true });
  return { report, reportHash };
}
