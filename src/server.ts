/**
 * ============================================================================
 * server.ts — Express application entry point
 * ============================================================================
 *
 * This file wires together:
 *   • The Express app instance
 *   • CORS configuration (permissive for local LAN use)
 *   • JSON body parsing middleware
 *   • The API router from routes.ts
 *   • A global error handler
 *   • The HTTP server, bound to 0.0.0.0:5000
 *
 * Run with:   npm run dev       (ts-node, development)
 *             npm run build     (compile to dist/)
 *             npm start         (node dist/server.js, production)
 * ============================================================================
 */

import express, { Application, Request, Response, NextFunction } from "express";
import cors, { CorsOptions } from "cors";

import invoiceRouter from "./routes";
import { readDb } from "./db";

// ============================================================================
// App instantiation
// ============================================================================

const app: Application = express();

// ============================================================================
// CORS — Allow all local network traffic
// ============================================================================
//
// The shop's setup: Windows PC (server, port 5000) + older Mac (client browser).
// Both machines are on the same LAN subnet (e.g. 192.168.x.x or 10.0.x.x).
//
// CorsOptions below allows:
//   origin: true   → reflect ANY requesting origin back in the response header.
//                    This means any machine on the local network (or localhost)
//                    can call the API from a browser without CORS errors.
//                    DO NOT use this setting on a public-facing server.
//
//   credentials: true → allows browsers to send cookies / Authorization headers
//                        if the frontend ever adds authentication in a later phase.
//
// If you want to lock it down to specific IPs later, replace `origin: true`
// with an array: origin: ["http://192.168.1.50:3000", "http://localhost:3000"]
//

const corsOptions: CorsOptions = {
  origin: true, // reflect all origins — safe on a private LAN
  credentials: true, // forward auth headers if needed in future phases
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(cors(corsOptions));

// Handle pre-flight OPTIONS requests for all routes.
// Browsers send a pre-flight OPTIONS before a POST/PUT to check CORS headers.
app.options("/{*path}", cors(corsOptions));

// ============================================================================
// Body parsing middleware
// ============================================================================
//
// express.json() parses incoming requests with Content-Type: application/json
// and makes the parsed object available as req.body.
//
// The limit is set to "1mb" which is more than enough for the largest
// conceivable print shop invoice payload.
//

app.use(express.json({ limit: "1mb" }));

// ============================================================================
// Request logger (lightweight development aid)
// ============================================================================
//
// Logs every incoming request to the console with a timestamp so you can
// follow traffic in real time while testing from the Mac client.
//

app.use((req: Request, _res: Response, next: NextFunction): void => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.url}`);
  next(); // must call next() to pass control to the next middleware/handler
});

// ============================================================================
// API routes
// ============================================================================
//
// All invoice endpoints are mounted under /api.  The router in routes.ts
// handles /invoices, /invoices/:id/void, etc.
//

app.use("/api", invoiceRouter);

// ============================================================================
// Health-check endpoint
// ============================================================================
//
// GET /health lets you quickly confirm the server is running and can read the
// database, without touching any invoice data.
//

app.get("/health", (_req: Request, res: Response): void => {
  try {
    const db = readDb();
    res.status(200).json({
      status: "ok",
      invoiceCount: db.invoices.length,
      clientCount: db.clients.length,
      nextInvoiceNum: db.nextInvoiceNumber,
      serverTime: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ status: "error", message: (err as Error).message });
  }
});

// ============================================================================
// 404 handler — must come after all valid routes
// ============================================================================

app.use((_req: Request, res: Response): void => {
  res.status(404).json({ error: "Endpoint not found." });
});

// ============================================================================
// Global error handler
// ============================================================================
//
// Express recognises a 4-argument middleware function as an error handler.
// Any unhandled error thrown inside a route handler lands here.
// We return 500 and log the stack trace so you can debug from the server console.
//

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use(
  (err: Error, _req: Request, res: Response, _next: NextFunction): void => {
    console.error("[ERROR]", err.stack ?? err.message);
    res.status(500).json({
      error: "Internal server error.",
      message: err.message,
    });
  },
);

// ============================================================================
// Start listening
// ============================================================================
//
// "0.0.0.0" binds to ALL network interfaces on the Windows PC — both
// localhost (127.0.0.1) and the LAN IP (e.g. 192.168.1.x).
// Without this, Express defaults to "localhost" only and the Mac can't reach it.
//

const PORT = parseInt(process.env.PORT ?? "5000", 10);
const HOST = "0.0.0.0";

app.listen(PORT, HOST, (): void => {
  console.log("=".repeat(60));
  console.log(`  The Printing Edge — Invoice Server`);
  console.log(`  Listening on http://${HOST}:${PORT}`);
  console.log(`  LAN clients: http://<your-windows-ip>:${PORT}`);
  console.log(`  Health check: http://localhost:${PORT}/health`);
  console.log("=".repeat(60));

  // Confirm database is readable on startup.
  try {
    const db = readDb();
    console.log(
      `  Database ready — ` +
        `${db.invoices.length} invoice(s), ` +
        `${db.clients.length} client(s), ` +
        `next invoice #${db.nextInvoiceNumber}`,
    );
  } catch (err) {
    console.error(
      "  [WARNING] Could not read database.json on startup:",
      (err as Error).message,
    );
  }

  console.log("=".repeat(60));
});

export default app;
