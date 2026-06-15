/**
 * ============================================================================
 * types.ts — Shared TypeScript interfaces for the Printing Edge backend
 * ============================================================================
 *
 * Every shape of data that flows through the system is defined here: what
 * lives in database.json, what the API accepts as request bodies, and what
 * the API returns as responses.  Keeping types in one place means TypeScript
 * can catch mismatches across all files at compile time.
 * ============================================================================
 */

// ---------------------------------------------------------------------------
// CLIENT
// ---------------------------------------------------------------------------

/**
 * A customer record.  clientId is a UUID generated once on first encounter;
 * all subsequent invoices reference this same ID so analytics can aggregate
 * revenue per client without duplicating contact data.
 */
export interface Client {
  clientId: string;          // UUID v4, e.g. "a1b2c3d4-..."
  companyName: string;       // "BARNABAS GROUP"
  contactName: string;       // "DAVE FOLEY"
  email: string;             // may be empty string "" if not provided
  phone: string;             // "604-816-5639"
  createdAt: string;         // ISO 8601, e.g. "2026-04-20T14:30:00.000Z"
}

// ---------------------------------------------------------------------------
// JOB  (one row on the physical docket sheet)
// ---------------------------------------------------------------------------

/**
 * A single production job within an invoice.  Matches the fields visible on
 * the "Docket printing edge.jpg" form — each column on that sheet becomes one
 * Job object in the jobs[] array.
 *
 * All monetary values are stored as INTEGER CENTS (never floats) to avoid
 * IEEE-754 rounding errors when accumulating totals across many jobs.
 */
export interface Job {
  jobIndex: number;            // 1-based position on the docket (1, 2, 3, 4)
  paperType: string;           // e.g. "NO.10 WHITE ENVELOPES"
  qtyPerItemSheet: number;     // quantity of items per sheet/run
  noOfItemsSheet: number;      // number of item types on the sheet
  inkColoursSide1: string;     // e.g. "PMS 286 BLUE" or "4/C Process"
  inkColoursSide2: string;     // blank string if one-sided
  finishSize: string;          // e.g. '4.125" x 9.5"'
  foldedSize: string;          // blank string if no fold
  bindery: string;             // e.g. "Saddle Stitch", "Perfect Bind", ""
  remarks: string;             // free-text job description / special notes
  printingPriceCents: number;  // this job's price in CENTS, e.g. 16400 = $164.00
}

// ---------------------------------------------------------------------------
// INVOICE  (the top-level docket / order record)
// ---------------------------------------------------------------------------

/**
 * The master invoice document stored in database.json["invoices"].
 *
 * Financial fields:
 *   preTaxCents   = sum of all job.printingPriceCents
 *   gstCents      = Math.round(preTaxCents * 0.05)   — Canada federal 5 %
 *   pstCents      = Math.round(preTaxCents * 0.07)   — BC provincial 7 %
 *   totalCents    = preTaxCents + gstCents + pstCents
 *   balanceCents  = totalCents  - depositCents
 */
export interface Invoice {
  invoiceNumber: number;    // integer, incremented from nextInvoiceNumber
  clientId: string;         // FK → clients[].clientId
  dateString: string;       // human-readable date, e.g. "April 20, 2026"
  terms: string;            // e.g. "Net 30 Days"
  jobs: Job[];              // one or more production jobs on this docket

  // --- aggregate financials (all in cents) ---
  preTaxCents: number;
  gstCents: number;
  pstCents: number;
  totalCents: number;
  depositCents: number;
  balanceCents: number;

  status: "Active" | "Voided";
  createdAt: string;        // ISO 8601 timestamp of record creation
}

// ---------------------------------------------------------------------------
// DATABASE FILE SHAPE
// ---------------------------------------------------------------------------

/**
 * The complete structure written to / read from database.json.
 *
 * Using a normalized layout (clients and invoices as separate arrays) mirrors
 * a simple relational schema — the same pattern you'd use with SQLite or
 * Postgres — so migrating later is straightforward.
 */
export interface Database {
  nextInvoiceNumber: number;  // auto-increment counter; start at 15758
  clients: Client[];
  invoices: Invoice[];
}

// ---------------------------------------------------------------------------
// REQUEST BODY  (what POST /api/invoices accepts)
// ---------------------------------------------------------------------------

/**
 * The payload the React frontend sends when creating a new invoice.
 * Client identity is sent as a flat object; the server either finds a
 * matching client or creates a new one.  Tax and total fields are NOT
 * included — the server always calculates those from scratch to prevent
 * client-side tampering.
 */
export interface CreateInvoiceBody {
  // --- client fields (server resolves/upserts) ---
  companyName: string;
  contactName: string;
  email: string;
  phone: string;

  // --- invoice-level fields ---
  dateString: string;
  terms: string;
  depositCents: number;   // integer cents; 0 if no deposit taken

  // --- jobs array (one element minimum) ---
  jobs: Omit<Job, "jobIndex">[];  // frontend omits jobIndex; server assigns it
}

// ---------------------------------------------------------------------------
// RESPONSE SHAPE  (GET /api/invoices enriched record)
// ---------------------------------------------------------------------------

/**
 * When the dashboard fetches invoices it needs the company name alongside
 * each record without having to do a separate client lookup.  This type
 * extends Invoice with the denormalized display field.
 */
export interface InvoiceWithClient extends Invoice {
  companyName: string;   // joined from clients[] for convenient rendering
}
