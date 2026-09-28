// SPEC §6.3 Task 5 — deterministic invoice anomaly rules R1–R7. The LLM only words the result.
import type { InvoiceExtraction, InvoiceReport } from "@nestledger/shared/schemas";
import { hamming } from "./integrity.js";
import type { PaidInvoice, PendingProposal } from "./history.js";

type Severity = "info" | "low" | "medium" | "high";
export type Check = InvoiceReport["checks"][number];

const DAY = 86_400;
const WEIGHT: Record<Severity, number> = { info: 0, low: 10, medium: 25, high: 40 };
export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export type AnomalyInput = {
  extraction: InvoiceExtraction;
  payee: string;
  category: string;
  proposedINR: number;
  fileHashes: string[];
  phashes: string[];
  tier1LimitINR: number;
  paid: PaidInvoice[];
  pending: PendingProposal[];
  now: number; // unix seconds
};

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const round2 = (x: number) => Math.round(x * 100) / 100;

function check(ruleId: Check["ruleId"], failed: Severity | null, facts: Check["facts"]): Check {
  return { ruleId, passed: failed === null, severity: failed ?? "info", facts };
}

function spike(ruleId: "R1" | "R2", total: number, history: number[], minCount: number, label: string): Check {
  if (history.length < minCount) return check(ruleId, null, { basis: label, priorInvoices: history.length, note: "not enough history" });
  const med = median(history);
  const ratio = med > 0 ? round2(total / med) : 0;
  const sev: Severity | null = ratio >= 3 ? "high" : ratio >= 2 ? "medium" : null;
  return check(ruleId, sev, { basis: label, priorInvoices: history.length, medianINR: med, totalINR: total, ratio });
}

export function runAnomalyRules(input: AnomalyInput): { checks: Check[]; riskScore: number; flagged: boolean } {
  const { extraction: x, now } = input;
  const payee = input.payee.toLowerCase();
  const total = x.totalINR;
  const vendorPaid = input.paid.filter((p) => p.payee === payee);

  const r1 = spike("R1", total,
    input.paid.filter((p) => p.category === input.category && p.executedAt >= now - 180 * DAY).map((p) => p.amountINR),
    3, `${input.category} invoices, last 180 days`);

  const r2 = spike("R2", total, vendorPaid.map((p) => p.amountINR), 2, "this vendor's invoices");

  const recent = [
    ...vendorPaid.filter((p) => p.executedAt >= now - 30 * DAY).map((p) => p.amountINR),
    ...input.pending.map((p) => p.amountINR),
    input.proposedINR,
  ];
  const recentSum = recent.reduce((a, b) => a + b, 0);
  const split = recent.length >= 2 && recent.every((a) => a <= input.tier1LimitINR) && recentSum > input.tier1LimitINR;
  const r3 = check("R3", split ? "high" : null, { invoicesLast30Days: recent.length, sumINR: recentSum, tier1LimitINR: input.tier1LimitINR });

  // Invoices printed from one vendor template have near-identical perceptual hashes (measured distance 0 at
  // 64 bits), so pHash similarity only counts when the invoice number couldn't be read (see SPEC-CHANGES).
  const sameNumber = x.invoiceNumber.trim() ? vendorPaid.find((p) => p.invoiceNumber === x.invoiceNumber) : undefined;
  const sameFile = input.paid.find((p) => p.fileHashes.some((h) => input.fileHashes.includes(h)));
  let nearFile: { proposalId: string; distance: number } | null = null;
  if (!x.invoiceNumber.trim()) {
    for (const p of input.paid) {
      for (const ph of p.phashes) {
        for (const mine of input.phashes) {
          if (ph.length !== mine.length) continue;
          const d = hamming(ph, mine);
          if (d <= 6 && (!nearFile || d < nearFile.distance)) nearFile = { proposalId: p.proposalId, distance: d };
        }
      }
    }
  }
  const r4 = check("R4", sameNumber || sameFile || nearFile ? "high" : null, {
    invoiceNumber: x.invoiceNumber || "unreadable",
    ...(sameNumber ? { sameNumberAsProposal: sameNumber.proposalId } : {}),
    ...(sameFile ? { sameFileAsProposal: sameFile.proposalId } : {}),
    ...(nearFile ? { similarFileInProposal: nearFile.proposalId, hammingDistance: nearFile.distance } : {}),
  });

  const lineSum = round2(x.lineItems.reduce((a, l) => a + l.amountINR, 0));
  const arithGap = round2(Math.abs(lineSum + x.taxINR - total));
  const proposedGapPct = total > 0 ? round2((Math.abs(total - input.proposedINR) / total) * 100) : 0;
  const r5 = check("R5", proposedGapPct > 1 ? "high" : arithGap > 1 ? "medium" : null, {
    lineItemsINR: lineSum, taxINR: x.taxINR, totalINR: total, arithmeticGapINR: arithGap, proposedINR: input.proposedINR, proposedGapPct,
  });

  const badGstin = x.taxINR > 0 && (!x.vendorGSTIN || !GSTIN_RE.test(x.vendorGSTIN));
  const r6 = check("R6", badGstin ? "low" : null, { taxINR: x.taxINR, gstin: x.vendorGSTIN ?? "missing" });

  const newLarge = vendorPaid.length === 0 && total > input.tier1LimitINR;
  const r7 = check("R7", newLarge ? "medium" : null, { priorInvoicesFromVendor: vendorPaid.length, totalINR: total, tier1LimitINR: input.tier1LimitINR });

  const checks = [r1, r2, r3, r4, r5, r6, r7];
  const failed = checks.filter((c) => !c.passed);
  return {
    checks,
    riskScore: Math.min(100, failed.reduce((a, c) => a + WEIGHT[c.severity], 0)),
    flagged: failed.some((c) => c.severity === "medium" || c.severity === "high"),
  };
}

const inr = (n: number | string) => `₹${Number(n).toLocaleString("en-IN")}`;

/** Plain sentences built only from the computed facts: the fallback (and fixtures-mode) justification. */
export function templateJustification(checks: Check[]): string {
  const failed = checks.filter((c) => !c.passed);
  if (!failed.length) return "No anomalies: the amount, vendor history and arithmetic are consistent with past spending.";
  return failed
    .map((c) => {
      const f = c.facts;
      switch (c.ruleId) {
        case "R1": return `The total of ${inr(f.totalINR)} is ${f.ratio}× the median of ${inr(f.medianINR)} across ${f.priorInvoices} ${f.basis}.`;
        case "R2": return `It is ${f.ratio}× this vendor's median invoice of ${inr(f.medianINR)}.`;
        case "R3": return `This vendor has ${f.invoicesLast30Days} invoices in 30 days, each under the ${inr(f.tier1LimitINR)} limit but totalling ${inr(f.sumINR)}.`;
        case "R4": return `It matches an earlier invoice (${f.sameNumberAsProposal ? `same invoice number ${f.invoiceNumber}, proposal #${f.sameNumberAsProposal}` : f.sameFileAsProposal ? `the same file as proposal #${f.sameFileAsProposal}` : `a near-identical image in proposal #${f.similarFileInProposal}, invoice number unreadable`}).`;
        case "R5": return Number(f.proposedGapPct) > 1
          ? `The invoice total ${inr(f.totalINR)} differs from the proposed ${inr(f.proposedINR)} by ${f.proposedGapPct}%.`
          : `Line items plus tax differ from the total by ${inr(f.arithmeticGapINR)}.`;
        case "R6": return `Tax of ${inr(f.taxINR)} is charged but the GSTIN is ${f.gstin === "missing" ? "missing" : "invalid"}.`;
        case "R7": return `This is the vendor's first invoice and it exceeds the ${inr(f.tier1LimitINR)} limit.`;
      }
    })
    .join(" ");
}
