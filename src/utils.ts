/**
 * ============================================================================
 * utils.ts — Pure utility functions: safe currency math & filename helpers
 * ============================================================================
 */

import { Job } from "./types";

// ============================================================================
// SECTION 1 — SAFE INTEGER CURRENCY MATH
// ============================================================================

export function sumJobPrices(jobs: Job[]): number {
  return jobs.reduce(
    (acc: number, job: Job) => acc + job.printingPriceCents,
    0,
  );
}

export function calcGst(preTaxCents: number): number {
  return Math.round(preTaxCents * 0.05);
}

export function calcPst(preTaxCents: number): number {
  return Math.round(preTaxCents * 0.07);
}

export function calcTotals(
  jobs: Job[],
  depositCents: number,
): {
  preTaxCents: number;
  gstCents: number;
  pstCents: number;
  totalCents: number;
  balanceCents: number;
} {
  const preTaxCents = sumJobPrices(jobs);
  const gstCents = calcGst(preTaxCents);
  const pstCents = calcPst(preTaxCents);
  const totalCents = preTaxCents + gstCents + pstCents;
  const balanceCents = totalCents - depositCents;
  return { preTaxCents, gstCents, pstCents, totalCents, balanceCents };
}

// ============================================================================
// SECTION 2 — FILENAME CONVENTION HELPER
// ============================================================================

/**
 * buildFilename()
 *
 * New format (per Phase 4 spec):
 *   "[CompanyName], [TypeOfJob], [6-digit zero-padded InvoiceNumber].pdf"
 *
 * Examples:
 *   buildFilename("BARNABAS GROUP", "Brochures", 15758)
 *   → "BARNABAS GROUP, Brochures, 015758.pdf"
 *
 * @param companyName   Client's company name.
 * @param typeOfJob     Selected type-of-job (e.g. "Brochures").
 * @param invoiceNumber Integer invoice number.
 */
export function buildFilename(
  companyName: string,
  typeOfJob: string,
  invoiceNumber: number,
): string {
  const paddedNumber = invoiceNumber.toString().padStart(6, "0");
  return `${companyName}, ${typeOfJob}, ${paddedNumber}.pdf`;
}

// ============================================================================
// SECTION 3 — DISPLAY / FORMATTING HELPERS
// ============================================================================

export function centsToDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
