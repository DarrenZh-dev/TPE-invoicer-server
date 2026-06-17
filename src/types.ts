/**
 * ============================================================================
 * types.ts — Shared TypeScript interfaces for the Printing Edge backend
 * ============================================================================
 */

// ---------------------------------------------------------------------------
// CLIENT
// ---------------------------------------------------------------------------

export interface Client {
  clientId: string;
  companyName: string;
  contactName: string;
  email: string;
  phone: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// JOB
// ---------------------------------------------------------------------------

export interface Job {
  jobIndex: number;
  paperType: string;
  qtyPerItemSheet: number;
  noOfItemsSheet: number;
  inkColoursSide1: string;
  inkColoursSide2: string;
  finishSize: string;
  foldedSize: string;
  bindery: string;
  remarks: string;
  printingPriceCents: number;
}

// ---------------------------------------------------------------------------
// WORKFLOW STATUS
// ---------------------------------------------------------------------------

/**
 * WorkflowStatus — the production pipeline stage of an active invoice.
 *
 * "Active"   is the initial state when an invoice is created.
 * "Finished" causes the invoice to be hidden from the Active Invoices table
 *            (but kept in the database and still accessible via the API).
 * "Voided"   marks a cancelled invoice — also hidden from Active Invoices.
 *
 * The stages in order:
 *   Active → Waiting for Artwork → Proof → Print → Invoice → Delivery → Finished
 */
export type WorkflowStatus =
  | "Active"
  | "Waiting for Artwork"
  | "Proof"
  | "Print"
  | "Invoice"
  | "Delivery"
  | "Finished"
  | "Voided";

// ---------------------------------------------------------------------------
// INVOICE
// ---------------------------------------------------------------------------

export interface Invoice {
  invoiceNumber: number;
  clientId: string;
  dateString: string;
  terms: string;
  typeOfJob: string;        // NEW: e.g. "Brochures", "Business cards", etc.
  jobs: Job[];

  preTaxCents: number;
  gstCents: number;
  pstCents: number;
  totalCents: number;
  depositCents: number;
  balanceCents: number;

  status: WorkflowStatus;  // UPDATED: replaces "Active" | "Voided" union
  createdAt: string;
}

// ---------------------------------------------------------------------------
// DATABASE FILE SHAPE
// ---------------------------------------------------------------------------

export interface Database {
  nextInvoiceNumber: number;
  clients: Client[];
  invoices: Invoice[];
}

// ---------------------------------------------------------------------------
// REQUEST BODY  (what POST /api/invoices accepts)
// ---------------------------------------------------------------------------

export interface CreateInvoiceBody {
  companyName: string;
  contactName: string;
  email: string;
  phone: string;

  dateString: string;
  terms: string;
  typeOfJob: string;        // NEW: required field from the frontend dropdown
  depositCents: number;

  jobs: Omit<Job, "jobIndex">[];
}

// ---------------------------------------------------------------------------
// RESPONSE SHAPE
// ---------------------------------------------------------------------------

export interface InvoiceWithClient extends Invoice {
  companyName: string;
}
