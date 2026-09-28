// SPEC §6.4 — a society's payment history, from the indexer's `events` table joined with stored invoice reports.
import { weiToInr } from "@nestledger/shared";
import { InvoiceDocSchema, type InvoiceReport } from "@nestledger/shared/schemas";
import type { Db } from "../db/index.js";

export type PaidInvoice = {
  proposalId: string;
  payee: string;
  category: string;
  amountINR: number;
  invoiceNumber: string | null;
  gstin: string | null;
  fileHashes: string[];
  phashes: string[];
  executedAt: number;
};

export type PendingProposal = { proposalId: string; amountINR: number; createdAt: number };

type Args = Record<string, string>;

function latestInvoiceReport(db: Db, proposalId: string): InvoiceReport | null {
  const row = db.get<{ json: string }>(
    "SELECT json FROM reports WHERE task = 'invoice' AND json_extract(json, '$.proposalId') = ? ORDER BY created_at DESC LIMIT 1",
    [proposalId],
  );
  return row ? (JSON.parse(row.json) as InvoiceReport) : null;
}

function invoiceFiles(db: Db, docHash: string): { fileHashes: string[]; phashes: string[] } {
  const row = db.get<{ json: string }>("SELECT json FROM manifests WHERE hash = ?", [docHash.toLowerCase()]);
  const doc = row ? InvoiceDocSchema.safeParse(JSON.parse(row.json)) : null;
  const fileHashes = doc?.success ? doc.data.files : [];
  const phashes = fileHashes
    .map((h) => db.get<{ phash: string | null }>("SELECT phash FROM evidence WHERE hash = ?", [h])?.phash)
    .filter((p): p is string => !!p);
  return { fileHashes, phashes };
}

/** Executed PayVendor proposals of a society since `sinceTs` (unix seconds). Amounts are the on-chain ones. */
export function paidInvoices(db: Db, societyId: string, sinceTs: number): PaidInvoice[] {
  const rows = db.query<{ created: string; ts: number }>(
    `SELECT c.args_json AS created, e.ts AS ts FROM events e
       JOIN events c ON c.contract = 'SocietyLedger' AND c.name = 'ProposalCreated'
        AND json_extract(c.args_json, '$.proposalId') = json_extract(e.args_json, '$.proposalId')
     WHERE e.contract = 'SocietyLedger' AND e.name = 'ProposalExecuted'
       AND json_extract(e.args_json, '$.kind') = '0'
       AND json_extract(c.args_json, '$.societyId') = ? AND e.ts >= ?`,
    [societyId, sinceTs],
  );
  return rows.map((r) => {
    const c = JSON.parse(r.created) as Args;
    const report = latestInvoiceReport(db, c.proposalId);
    return {
      proposalId: c.proposalId,
      payee: c.payee.toLowerCase(),
      category: c.category,
      amountINR: weiToInr(BigInt(c.amount)),
      invoiceNumber: report?.extraction.invoiceNumber ?? null,
      gstin: report?.extraction.vendorGSTIN ?? null,
      ...invoiceFiles(db, c.docHash),
      executedAt: r.ts,
    };
  });
}

/** PayVendor proposals to `payee` that are neither executed, rejected nor cancelled. */
export function pendingProposals(db: Db, societyId: string, payee: string): PendingProposal[] {
  const rows = db.query<{ args_json: string; ts: number }>(
    `SELECT c.args_json, c.ts FROM events c
     WHERE c.contract = 'SocietyLedger' AND c.name = 'ProposalCreated'
       AND json_extract(c.args_json, '$.societyId') = ? AND json_extract(c.args_json, '$.kind') = '0'
       AND lower(json_extract(c.args_json, '$.payee')) = ?
       AND NOT EXISTS (SELECT 1 FROM events d WHERE d.contract = 'SocietyLedger'
         AND d.name IN ('ProposalExecuted', 'ProposalRejected', 'ProposalCancelled')
         AND json_extract(d.args_json, '$.proposalId') = json_extract(c.args_json, '$.proposalId'))`,
    [societyId, payee.toLowerCase()],
  );
  return rows.map((r) => {
    const c = JSON.parse(r.args_json) as Args;
    return { proposalId: c.proposalId, amountINR: weiToInr(BigInt(c.amount)), createdAt: r.ts };
  });
}
