/**
 * ============================================================================
 * routes.ts — Express route handlers for all three API endpoints
 * ============================================================================
 *
 * Endpoints implemented here:
 *   POST   /api/invoices          — Create a new multi-job invoice
 *   GET    /api/invoices          — Fetch all invoices (joined with client name)
 *   PUT    /api/invoices/:id/void — Void an existing invoice by invoiceNumber
 *
 * Each handler follows the same pattern:
 *   1. Parse & validate the incoming data.
 *   2. Read the current database state from disk.
 *   3. Perform the business logic (client resolution, tax math, etc.).
 *   4. Write the updated state back to disk.
 *   5. Return a JSON response.
 * ============================================================================
 */

import { Router, Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import nodePath from "path";

import { readDb, writeDb } from "./db";
import { calcTotals, buildFilename, centsToDollars } from "./utils";
import { Client, Invoice, Job, CreateInvoiceBody, InvoiceWithClient } from "./types";
import { generateAllVariants } from "./pdfGenerator";

// Absolute path to the ./invoices output folder, resolved from the project root.
// __dirname here points to src/ (or dist/ when compiled), so we go one level up.
const INVOICES_DIR = nodePath.resolve(__dirname, "../invoices");

const router = Router();

// ============================================================================
// POST /api/invoices
// ============================================================================
// Creates a new invoice.  The handler:
//   a) Resolves (or creates) the client record
//   b) Assigns jobIndex values to each submitted job
//   c) Calculates all tax and balance fields with safe integer math
//   d) Increments nextInvoiceNumber
//   e) Persists everything to database.json
//   f) Returns the finished invoice object plus a suggested filename
// ============================================================================

router.post("/invoices", async (req: Request, res: Response): Promise<void> => {
  // NOTE: This handler is declared `async` because generateInvoicePdf() returns
  // a Promise.  We await it before sending the HTTP response so the client only
  // receives the success payload once the PDF file is fully written to disk.
  // Express 4.x handles rejected async handler promises correctly as long as
  // we call next(err) on catch — we do that at the bottom of this handler.
  // ── 1. Parse request body ─────────────────────────────────────────────────
  //
  // TypeScript casts req.body to our expected shape.  In production you would
  // validate this with zod or joi; here we do basic presence checks.
  const body = req.body as CreateInvoiceBody;

  // Validate that the minimum required fields are present.
  if (!body.companyName || !body.dateString || !Array.isArray(body.jobs) || body.jobs.length === 0) {
    res.status(400).json({
      error: "Missing required fields: companyName, dateString, and at least one job are required.",
    });
    return;
  }

  // Validate that every job has a printingPriceCents value that is a
  // non-negative integer (protects against accidental float submissions).
  for (let i = 0; i < body.jobs.length; i++) {
    const job = body.jobs[i];
    if (
      typeof job.printingPriceCents !== "number" ||
      !Number.isInteger(job.printingPriceCents) ||
      job.printingPriceCents < 0
    ) {
      res.status(400).json({
        error: `Job at index ${i}: printingPriceCents must be a non-negative integer (cents). Got: ${job.printingPriceCents}`,
      });
      return;
    }
  }

  // depositCents defaults to 0 if omitted or not a valid integer.
  const depositCents =
    typeof body.depositCents === "number" && Number.isInteger(body.depositCents) && body.depositCents >= 0
      ? body.depositCents
      : 0;

  // ── 2. Read current database state ───────────────────────────────────────

  const db = readDb();

  // ── 3a. Client resolution / upsert ───────────────────────────────────────
  //
  // Look for an existing client whose companyName matches (case-insensitive).
  // This lets the operator re-use the same client record across many invoices
  // without manually supplying a clientId each time.
  //
  // .find() iterates the clients array and returns the FIRST element where
  // the callback returns true, or undefined if no match is found.
  let client: Client | undefined = db.clients.find(
    (c: Client) => c.companyName.toLowerCase() === body.companyName.toLowerCase()
  );

  if (client) {
    // ── Existing client — update contact fields in case they changed ────────
    console.log(`[POST /invoices] Found existing client: ${client.clientId} (${client.companyName})`);

    // We update the mutable fields but preserve the original clientId and
    // createdAt timestamp so that historical invoices still resolve correctly.
    client.contactName = body.contactName || client.contactName;
    client.email       = body.email       || client.email;
    client.phone       = body.phone       || client.phone;
  } else {
    // ── New client — create a fresh record ──────────────────────────────────
    client = {
      clientId:    uuidv4(),                    // unique ID, never changes
      companyName: body.companyName,
      contactName: body.contactName  || "",
      email:       body.email        || "",
      phone:       body.phone        || "",
      createdAt:   new Date().toISOString(),
    };

    // Push the new client into the array.  Because `db` is a reference to
    // the object we read from disk, this mutation will be included when we
    // call writeDb(db) at the end.
    db.clients.push(client);
    console.log(`[POST /invoices] Created new client: ${client.clientId} (${client.companyName})`);
  }

  // ── 3b. Assign jobIndex to each submitted job ────────────────────────────
  //
  // The frontend sends jobs without a jobIndex field (it's omitted in the
  // CreateInvoiceBody type).  We map over the raw array and assign a 1-based
  // index so the docket layout ("JOB ORDER #1", "#2", …) is preserved.
  //
  // Array.map() transforms each element; the second argument to the callback
  // is the zero-based array index `i`, which we convert to 1-based by adding 1.
  const jobs: Job[] = body.jobs.map(
    (rawJob, i: number): Job => ({
      jobIndex:           i + 1,                // 1-based: first job is 1, not 0
      paperType:          rawJob.paperType          || "",
      qtyPerItemSheet:    rawJob.qtyPerItemSheet    ?? 0,
      noOfItemsSheet:     rawJob.noOfItemsSheet     ?? 0,
      inkColoursSide1:    rawJob.inkColoursSide1    || "",
      inkColoursSide2:    rawJob.inkColoursSide2    || "",
      finishSize:         rawJob.finishSize         || "",
      foldedSize:         rawJob.foldedSize         || "",
      bindery:            rawJob.bindery            || "",
      remarks:            rawJob.remarks            || "",
      printingPriceCents: rawJob.printingPriceCents,  // already validated above
    })
  );

  // ── 3c. Integer tax and total calculations ───────────────────────────────
  //
  // calcTotals() is the single source of truth for all financial math.
  // See utils.ts for a detailed line-by-line explanation of the arithmetic.
  //
  // Destructuring assignment pulls all five fields out of the returned object
  // in one line.
  const { preTaxCents, gstCents, pstCents, totalCents, balanceCents } =
    calcTotals(jobs, depositCents);

  console.log(
    `[POST /invoices] Financials — ` +
    `preTax: ${centsToDollars(preTaxCents)}, ` +
    `GST: ${centsToDollars(gstCents)}, ` +
    `PST: ${centsToDollars(pstCents)}, ` +
    `total: ${centsToDollars(totalCents)}, ` +
    `deposit: ${centsToDollars(depositCents)}, ` +
    `balance: ${centsToDollars(balanceCents)}`
  );

  // ── 3d. Claim and increment the invoice number ───────────────────────────
  //
  // We read the current counter BEFORE incrementing so this invoice gets
  // the value currently stored (15758 on first run), then we immediately
  // bump it so the NEXT invoice gets 15759, and so on.
  const invoiceNumber = db.nextInvoiceNumber;
  db.nextInvoiceNumber = invoiceNumber + 1;   // persist the bump in writeDb below

  // ── 3e. Assemble the complete Invoice record ─────────────────────────────

  const newInvoice: Invoice = {
    invoiceNumber,
    clientId:      client.clientId,
    dateString:    body.dateString,
    terms:         body.terms || "Net 30 Days",
    jobs,                          // the mapped & validated jobs array
    preTaxCents,
    gstCents,
    pstCents,
    totalCents,
    depositCents,
    balanceCents,
    status:        "Active",
    createdAt:     new Date().toISOString(),
  };

  // Push the new invoice into the invoices array.
  db.invoices.push(newInvoice);

  // ── 4. Persist to disk ───────────────────────────────────────────────────
  //
  // writeDb() serializes the ENTIRE db object (with all mutations applied
  // above: possibly a new/updated client, the new invoice, and the
  // incremented counter) back to database.json in one atomic write.
  writeDb(db);

  // ── 5. Generate the PDF file before responding ──────────────────────────
  //
  // generateInvoicePdf() streams the PDFKit document to disk and resolves
  // only after the WriteStream 'finish' event fires.  Awaiting it here
  // means the HTTP 201 response is sent only once the .pdf is fully written.
  //
  // We wrap in try/catch so a PDF rendering failure (e.g. a disk-full error)
  // does NOT prevent the invoice record from being returned — the invoice is
  // already saved to database.json at this point.  The error is logged and
  // the response includes a pdfError field so the frontend can surface a
  // non-fatal warning ("Invoice saved but PDF could not be generated").

  // ── 5. Generate all three PDF variants before responding ───────────────────
  //
  // generateAllVariants() produces three PDFs in parallel:
  //   [0] Customer copy  → ./invoices/[Name] - [Type] #[000000].pdf
  //   [1] Production copy→ ./invoices/[Name] - [Type] #[000000] PRODUCTION.pdf
  //   [2] Print copy     → ./print-invoices/[Name] - [Type] #[000000] PRINT.pdf
  //
  // We await all three before responding so the HTTP 201 is sent only after
  // every file is fully on disk.  A try/catch ensures a disk error does not
  // lose the already-saved database record — pdfError surfaces in the response
  // as a non-fatal warning the frontend can display.

  const suggestedFilename = buildFilename(
    client.companyName,
    jobs[0].paperType || "ORDER",
    invoiceNumber
  );

  let pdfPaths: string[]    = [];
  let pdfError: string | null = null;

  try {
    pdfPaths = await generateAllVariants(newInvoice, client, INVOICES_DIR);
    console.log(`[POST /invoices] PDFs written: ${pdfPaths.join(", ")}`);
  } catch (err) {
    pdfError = (err as Error).message;
    console.error(`[POST /invoices] PDF generation failed (invoice still saved): ${pdfError}`);
  }

  console.log(
    `[POST /invoices] Invoice #${invoiceNumber} created for "${client.companyName}" — ${suggestedFilename}`
  );

  res.status(201).json({
    invoice:           newInvoice,
    suggestedFilename,
    pdfPath:           pdfPaths[0] ?? null,       // customer copy path (primary)
    pdfPathProduction: pdfPaths[1] ?? null,        // production copy path
    pdfPathPrint:      pdfPaths[2] ?? null,        // print copy path
    pdfError,
  });
});

// ============================================================================
// GET /api/invoices
// ============================================================================
// Returns all invoice records, each enriched with the client's companyName.
// The frontend dashboard needs company names for display without making
// separate per-invoice client lookup calls.
// ============================================================================

router.get("/invoices", (req: Request, res: Response): void => {
  // ── 1. Read current database ─────────────────────────────────────────────

  const db = readDb();

  // ── 2. Join invoices with client company name ────────────────────────────
  //
  // Array.map() transforms each Invoice into an InvoiceWithClient by looking
  // up the matching Client in db.clients[].
  //
  // For each invoice:
  //   - db.clients.find() scans the clients array for the record whose
  //     clientId matches this invoice's clientId.
  //   - The optional-chaining operator (?.) safely accesses .companyName
  //     even if find() returns undefined (shouldn't happen with clean data,
  //     but defensive coding prevents a crash if a client was manually
  //     deleted from the file).
  //   - The spread operator (...invoice) copies all existing Invoice fields,
  //     then we add the extra companyName field on top.
  const enrichedInvoices: InvoiceWithClient[] = db.invoices.map(
    (invoice: Invoice): InvoiceWithClient => {
      // Find the client record that corresponds to this invoice.
      const matchedClient = db.clients.find(
        (c: Client) => c.clientId === invoice.clientId
      );

      // Build the enriched record.
      return {
        ...invoice,                                          // all Invoice fields
        companyName: matchedClient?.companyName ?? "Unknown Client",  // joined field
      };
    }
  );

  console.log(`[GET /invoices] Returning ${enrichedInvoices.length} invoice(s)`);

  res.status(200).json(enrichedInvoices);
});

// ============================================================================
// PUT /api/invoices/:id/void
// ============================================================================
// Sets the status of the specified invoice to "Voided".  The invoice record
// itself is never deleted — voiding is a soft-delete that preserves the full
// audit trail in database.json while marking the record as inactive.
//
// :id in the URL refers to invoiceNumber (the integer on the physical docket),
// NOT an array index or UUID, because that's the identifier the operator uses.
// ============================================================================

router.put("/invoices/:id/void", (req: Request, res: Response): void => {
  // ── 1. Parse the URL parameter ───────────────────────────────────────────
  //
  // req.params.id is always a string (URL params are text), so we convert it
  // to an integer with parseInt.  The radix 10 argument prevents accidental
  // octal parsing on strings like "015758".
  // req.params.id is typed as string | string[] in some Express typings;
  // we coerce it to a plain string before passing to parseInt.
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const invoiceNumber = parseInt(rawId, 10);

  if (isNaN(invoiceNumber)) {
    res.status(400).json({ error: `Invalid invoice number: "${rawId}" — must be an integer.` });
    return;
  }

  // ── 2. Read database ─────────────────────────────────────────────────────

  const db = readDb();

  // ── 3. Find the target invoice ───────────────────────────────────────────
  //
  // Array.findIndex() returns the POSITION of the first matching element,
  // or -1 if not found.  We need the index (not the object itself) so we can
  // modify the element in-place within the array.
  const invoiceIndex = db.invoices.findIndex(
    (inv: Invoice) => inv.invoiceNumber === invoiceNumber
  );

  if (invoiceIndex === -1) {
    res.status(404).json({ error: `Invoice #${invoiceNumber} not found.` });
    return;
  }

  // ── 4. Guard against double-voiding ─────────────────────────────────────
  //
  // Voiding an already-voided invoice is a no-op from a data perspective,
  // but returning 400 prevents the UI from showing a misleading "success"
  // message when the operator might have entered the wrong number.
  if (db.invoices[invoiceIndex].status === "Voided") {
    res.status(400).json({ error: `Invoice #${invoiceNumber} is already Voided.` });
    return;
  }

  // ── 5. Apply the void ────────────────────────────────────────────────────
  //
  // Direct mutation of the array element is safe here because we're about
  // to writeDb(db) immediately, which serializes the entire updated object.
  db.invoices[invoiceIndex].status = "Voided";

  // ── 6. Persist and respond ───────────────────────────────────────────────

  writeDb(db);

  console.log(`[PUT /invoices/:id/void] Invoice #${invoiceNumber} has been Voided.`);

  res.status(200).json({
    message:  `Invoice #${invoiceNumber} has been successfully Voided.`,
    invoice:  db.invoices[invoiceIndex],
  });
});

export default router;
