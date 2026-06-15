/**
 * ============================================================================
 * utils.ts — Pure utility functions: safe currency math & filename helpers
 * ============================================================================
 *
 * Keeping these as pure functions (no side effects, no imports from the rest
 * of the app) makes them trivial to unit-test in isolation.
 * ============================================================================
 */

import { Job } from "./types";

// ============================================================================
// SECTION 1 — SAFE INTEGER CURRENCY MATH
// ============================================================================

/**
 * WHY CENTS?
 * ----------
 * JavaScript's Number type is an IEEE-754 double-precision float.  Operations
 * like 0.1 + 0.2 yield 0.30000000000000004, not 0.3.  When those errors
 * accumulate across many jobs and tax calculations the final total can be off
 * by a cent or more — unacceptable for a billing system.
 *
 * The solution: store every monetary value as an INTEGER number of cents
 * (16400 = $164.00).  Integers are represented exactly in IEEE-754 up to
 * 2^53 − 1 (~9 quadrillion cents = ~90 trillion dollars), which is more than
 * enough for a print shop invoice.
 *
 * The only place floating-point arithmetic appears is inside Math.round()
 * during tax calculation, and Math.round() returns an integer, so the result
 * is immediately "snapped back" to a safe integer value.
 */

// ---------------------------------------------------------------------------
// sumJobPrices()
// ---------------------------------------------------------------------------

/**
 * Adds up the printingPriceCents field across every job in the array.
 *
 * Array.reduce() walks the jobs one by one, accumulating the running total
 * in `acc` (short for "accumulator").  The initial value of 0 ensures the
 * result is 0 (not undefined) when the array is empty.
 *
 * Example:
 *   jobs = [{ printingPriceCents: 16400 }, { printingPriceCents: 8500 }]
 *   → 16400 + 8500 = 24900  (= $249.00)
 *
 * @param jobs  Array of Job objects (may be empty).
 * @returns     Integer cents total.
 */
export function sumJobPrices(jobs: Job[]): number {
  return jobs.reduce(
    (acc: number, job: Job) => acc + job.printingPriceCents,
    0, // ← initial accumulator value
  );
}

// ---------------------------------------------------------------------------
// calcGst()
// ---------------------------------------------------------------------------

/**
 * Calculates Canadian federal GST (5 %) on a pre-tax amount.
 *
 * Math.round() is ESSENTIAL here.  Without it, 16400 * 0.05 = 820 exactly
 * in this case, but e.g. 16300 * 0.05 = 815.0000000000001 in floating point.
 * Math.round() snaps that fractional cent to the nearest integer.
 *
 * @param preTaxCents  Integer cents before tax.
 * @returns            GST in integer cents.
 */
export function calcGst(preTaxCents: number): number {
  return Math.round(preTaxCents * 0.05);
}

// ---------------------------------------------------------------------------
// calcPst()
// ---------------------------------------------------------------------------

/**
 * Calculates British Columbia PST (7 %) on a pre-tax amount.
 *
 * Note: In BC, PST is assessed on the pre-tax selling price, NOT on the
 * GST-inclusive price.  Both taxes are therefore computed independently from
 * preTaxCents, then summed.
 *
 * @param preTaxCents  Integer cents before tax.
 * @returns            PST in integer cents.
 */
export function calcPst(preTaxCents: number): number {
  return Math.round(preTaxCents * 0.07);
}

// ---------------------------------------------------------------------------
// calcTotals()
// ---------------------------------------------------------------------------

/**
 * Master financial calculator.  Given an array of jobs and a deposit amount,
 * returns every derived monetary field needed by the Invoice record.
 *
 * Step-by-step walkthrough (using the Barnabas Group sample invoice):
 *
 *   1. preTaxCents  = sum of job prices         →  16400  ($164.00)
 *   2. gstCents     = round(16400 × 0.05)       →    820  ($  8.20)
 *   3. pstCents     = round(16400 × 0.07)       →   1148  ($ 11.48)
 *   4. totalCents   = 16400 + 820 + 1148        →  18368  ($183.68)  ✓ matches invoice PDF
 *   5. balanceCents = 18368 − depositCents(0)   →  18368  ($183.68)
 *
 * @param jobs          The jobs[] array from the invoice.
 * @param depositCents  Deposit already paid (integer cents; 0 if none).
 * @returns             Object with all five financial fields.
 */
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
  // Step 1: Aggregate all job prices into pre-tax subtotal.
  const preTaxCents = sumJobPrices(jobs);

  // Step 2 & 3: Calculate each tax independently from pre-tax amount.
  const gstCents = calcGst(preTaxCents);
  const pstCents = calcPst(preTaxCents);

  // Step 4: Grand total = pre-tax + both taxes.
  const totalCents = preTaxCents + gstCents + pstCents;

  // Step 5: Outstanding balance = total owed minus any deposit received.
  const balanceCents = totalCents - depositCents;

  return { preTaxCents, gstCents, pstCents, totalCents, balanceCents };
}

// ============================================================================
// SECTION 2 — FILENAME CONVENTION HELPER
// ============================================================================

/**
 * buildFilename()
 * ---------------
 * Constructs the canonical PDF filename for a completed invoice, following
 * the exact pattern visible in the file naming convention screenshot:
 *
 *   "[CompanyName] - [FirstJobType] #[6-digit zero-padded InvoiceNumber].pdf"
 *
 * Examples:
 *   buildFilename("BARNABAS GROUP", "NO.10 WHITE ENVELOPES", 15758)
 *   → "BARNABAS GROUP - NO.10 WHITE ENVELOPES #015758.pdf"
 *
 *   buildFilename("CITY OF BURNABY", "Letterhead", 16002)
 *   → "CITY OF BURNABY - Letterhead #016002.pdf"
 *
 * Implementation notes:
 *   - String.padStart(6, "0") left-pads the invoice number with zeros until
 *     the string is 6 characters long.  If the number ever exceeds 999999
 *     the string will simply be longer than 6 chars (no truncation).
 *   - The "first job type" is derived from the paperType of jobs[0].  If
 *     the jobs array is somehow empty we fall back to "ORDER".
 *
 * @param companyName    Client's company name.
 * @param firstJobType   paperType of the first job on the docket.
 * @param invoiceNumber  Integer invoice number.
 * @returns              Formatted filename string including ".pdf" extension.
 */
export function buildFilename(
  companyName: string,
  firstJobType: string,
  invoiceNumber: number,
): string {
  // Zero-pad the invoice number to exactly 6 digits.
  // invoiceNumber.toString() → "15758"
  // "15758".padStart(6, "0") → "015758"
  const paddedNumber = invoiceNumber.toString().padStart(6, "0");

  // Assemble the filename using a template literal.
  return `${companyName} - ${firstJobType} #${paddedNumber}.pdf`;
}

// ============================================================================
// SECTION 3 — DISPLAY / FORMATTING HELPERS
// ============================================================================

/**
 * centsToDollars()
 * ----------------
 * Converts an integer cent value to a formatted dollar string for logging
 * and response payloads that want human-readable amounts.
 *
 * This is used only for console output and optional display fields — all
 * arithmetic in the system always uses the integer cent values.
 *
 * @param cents  Integer cent amount.
 * @returns      Dollar string, e.g. 18368 → "$183.68"
 */
export function centsToDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
