/**
 * ============================================================================
 * routes.ts — Express route handlers
 * ============================================================================
 *
 * Endpoints:
 *   POST   /api/invoices              — Create a new invoice
 *   GET    /api/invoices              — Fetch all invoices (joined with client name)
 *   PUT    /api/invoices/:id/void     — Void an invoice
 *   PUT    /api/invoices/:id/status   — Update workflow status (NEW)
 * ============================================================================
 */

import { Router, Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import nodePath from "path";

import { readDb, writeDb } from "./db";
import { calcTotals, buildFilename, centsToDollars } from "./utils";
import { Client, Invoice, Job, CreateInvoiceBody, InvoiceWithClient, WorkflowStatus } from "./types";
import { generateAllVariants } from "./pdfGenerator";

const INVOICES_DIR = nodePath.resolve(__dirname, "../invoices");

const router = Router();

// All valid workflow stages (used for validation)
const WORKFLOW_STAGES: WorkflowStatus[] = [
  "Active",
  "Waiting for Artwork",
  "Proof",
  "Print",
  "Invoice",
  "Delivery",
  "Finished",
  "Voided",
];

// ============================================================================
// POST /api/invoices
// ============================================================================

router.post("/invoices", async (req: Request, res: Response): Promise<void> => {
  const body = req.body as CreateInvoiceBody;

  if (!body.companyName || !body.dateString || !Array.isArray(body.jobs) || body.jobs.length === 0) {
    res.status(400).json({
      error: "Missing required fields: companyName, dateString, and at least one job are required.",
    });
    return;
  }

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

  const depositCents =
    typeof body.depositCents === "number" && Number.isInteger(body.depositCents) && body.depositCents >= 0
      ? body.depositCents
      : 0;

  const db = readDb();

  let client: Client | undefined = db.clients.find(
    (c: Client) => c.companyName.toLowerCase() === body.companyName.toLowerCase()
  );

  if (client) {
    client.contactName = body.contactName || client.contactName;
    client.email       = body.email       || client.email;
    client.phone       = body.phone       || client.phone;
  } else {
    client = {
      clientId:    uuidv4(),
      companyName: body.companyName,
      contactName: body.contactName || "",
      email:       body.email       || "",
      phone:       body.phone       || "",
      createdAt:   new Date().toISOString(),
    };
    db.clients.push(client);
  }

  const jobs: Job[] = body.jobs.map(
    (rawJob, i: number): Job => ({
      jobIndex:           i + 1,
      paperType:          rawJob.paperType          || "",
      qtyPerItemSheet:    rawJob.qtyPerItemSheet    ?? 0,
      noOfItemsSheet:     rawJob.noOfItemsSheet     ?? 0,
      inkColoursSide1:    rawJob.inkColoursSide1    || "",
      inkColoursSide2:    rawJob.inkColoursSide2    || "",
      finishSize:         rawJob.finishSize         || "",
      foldedSize:         rawJob.foldedSize         || "",
      bindery:            rawJob.bindery            || "",
      remarks:            rawJob.remarks            || "",
      printingPriceCents: rawJob.printingPriceCents,
    })
  );

  const { preTaxCents, gstCents, pstCents, totalCents, balanceCents } =
    calcTotals(jobs, depositCents);

  const invoiceNumber = db.nextInvoiceNumber;
  db.nextInvoiceNumber = invoiceNumber + 1;

  // typeOfJob: read from body, default to empty string if omitted
  const typeOfJob = (body.typeOfJob || "").trim();

  const newInvoice: Invoice = {
    invoiceNumber,
    clientId:   client.clientId,
    dateString: body.dateString,
    terms:      body.terms || "Net 30 Days",
    typeOfJob,                     // NEW field saved to database
    jobs,
    preTaxCents,
    gstCents,
    pstCents,
    totalCents,
    depositCents,
    balanceCents,
    status:    "Active",
    createdAt: new Date().toISOString(),
  };

  db.invoices.push(newInvoice);
  writeDb(db);

  // Build filename using the new format: "[Company], [TypeOfJob], [Number].pdf"
  const suggestedFilename = buildFilename(
    client.companyName,
    typeOfJob || "ORDER",
    invoiceNumber
  );

  let pdfPaths: string[]    = [];
  let pdfError: string | null = null;

  try {
    pdfPaths = await generateAllVariants(newInvoice, client, INVOICES_DIR);
  } catch (err) {
    pdfError = (err as Error).message;
    console.error(`[POST /invoices] PDF generation failed: ${pdfError}`);
  }

  res.status(201).json({
    invoice:           newInvoice,
    suggestedFilename,
    pdfPath:           pdfPaths[0] ?? null,
    pdfPathProduction: pdfPaths[1] ?? null,
    pdfPathPrint:      pdfPaths[2] ?? null,
    pdfError,
  });
});

// ============================================================================
// GET /api/invoices
// ============================================================================

router.get("/invoices", (req: Request, res: Response): void => {
  const db = readDb();

  const enrichedInvoices: InvoiceWithClient[] = db.invoices.map(
    (invoice: Invoice): InvoiceWithClient => {
      const matchedClient = db.clients.find(
        (c: Client) => c.clientId === invoice.clientId
      );
      return {
        ...invoice,
        companyName: matchedClient?.companyName ?? "Unknown Client",
        // Backwards-compat: old records won't have typeOfJob — default to ""
        typeOfJob: invoice.typeOfJob ?? "",
      };
    }
  );

  res.status(200).json(enrichedInvoices);
});

// ============================================================================
// PUT /api/invoices/:id/void
// ============================================================================

router.put("/invoices/:id/void", (req: Request, res: Response): void => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const invoiceNumber = parseInt(rawId, 10);

  if (isNaN(invoiceNumber)) {
    res.status(400).json({ error: `Invalid invoice number: "${rawId}"` });
    return;
  }

  const db = readDb();
  const idx = db.invoices.findIndex((inv: Invoice) => inv.invoiceNumber === invoiceNumber);

  if (idx === -1) {
    res.status(404).json({ error: `Invoice #${invoiceNumber} not found.` });
    return;
  }
  if (db.invoices[idx].status === "Voided") {
    res.status(400).json({ error: `Invoice #${invoiceNumber} is already Voided.` });
    return;
  }

  db.invoices[idx].status = "Voided";
  writeDb(db);

  res.status(200).json({
    message: `Invoice #${invoiceNumber} has been Voided.`,
    invoice: db.invoices[idx],
  });
});

// ============================================================================
// PUT /api/invoices/:id/status   (NEW)
// ============================================================================
// Updates the workflow status of an invoice to any valid WorkflowStatus value.
// The frontend uses this when the operator selects a stage from the dropdown.
// "Finished" invoices are filtered out of the Active Invoices list on the
// frontend but remain permanently in database.json.
// ============================================================================

router.put("/invoices/:id/status", (req: Request, res: Response): void => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const invoiceNumber = parseInt(rawId, 10);

  if (isNaN(invoiceNumber)) {
    res.status(400).json({ error: `Invalid invoice number: "${rawId}"` });
    return;
  }

  const { status } = req.body as { status: WorkflowStatus };

  if (!status || !WORKFLOW_STAGES.includes(status)) {
    res.status(400).json({
      error: `Invalid status "${status}". Must be one of: ${WORKFLOW_STAGES.join(", ")}`,
    });
    return;
  }

  const db = readDb();
  const idx = db.invoices.findIndex((inv: Invoice) => inv.invoiceNumber === invoiceNumber);

  if (idx === -1) {
    res.status(404).json({ error: `Invoice #${invoiceNumber} not found.` });
    return;
  }

  db.invoices[idx].status = status;
  writeDb(db);

  console.log(`[PUT /invoices/:id/status] Invoice #${invoiceNumber} → "${status}"`);

  res.status(200).json({
    message: `Invoice #${invoiceNumber} status updated to "${status}".`,
    invoice: db.invoices[idx],
  });
});

export default router;
