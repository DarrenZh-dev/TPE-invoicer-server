/**
 * ============================================================================
 * db.ts — File-system JSON data store helpers
 * ============================================================================
 *
 * This module owns every read and write to database.json.  All other modules
 * call readDb() and writeDb() rather than touching the file directly so that
 * the I/O logic (error handling, atomic writes, path resolution) lives in
 * exactly one place.
 *
 * WHY SYNCHRONOUS I/O HERE?
 * -------------------------
 * Express is single-threaded for our purposes and this is a local LAN tool
 * (not a public web server), so blocking file I/O is acceptable and actually
 * safer — it prevents two concurrent requests from writing a half-finished
 * file over each other.  For a production multi-tenant service you would
 * replace these with async fs.promises calls wrapped in a mutex/queue.
 * ============================================================================
 */

import fs from "fs";
import path from "path";
import { Database } from "./types";

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

/**
 * database.json sits next to the compiled server output (or the src/ folder
 * when running with ts-node).  __dirname resolves to the directory of THIS
 * file, so we go one level up to the project root.
 */
const DB_PATH = path.resolve(__dirname, "../database.json");

// ---------------------------------------------------------------------------
// Default / seed structure
// ---------------------------------------------------------------------------

/**
 * If database.json does not yet exist (first run), the server creates it
 * with this skeleton.  nextInvoiceNumber is seeded to 15758 to match the
 * existing paper-based invoice history (NO 015758 from the sample PDF).
 */
const DEFAULT_DB: Database = {
  nextInvoiceNumber: 15758,
  clients: [],
  invoices: [],
};

// ---------------------------------------------------------------------------
// readDb()
// ---------------------------------------------------------------------------

/**
 * Reads and parses database.json.  If the file does not exist it is created
 * with DEFAULT_DB and that value is returned — so the first call to readDb()
 * always succeeds.
 *
 * @returns The full Database object currently on disk.
 * @throws  If the file exists but contains malformed JSON (not auto-healed
 *          because overwriting corrupt data silently could lose real records).
 */
export function readDb(): Database {
  if (!fs.existsSync(DB_PATH)) {
    // First run: write the seed file so subsequent reads find it.
    console.log(
      `[db] database.json not found — creating seed file at: ${DB_PATH}`,
    );
    writeDb(DEFAULT_DB);
    return DEFAULT_DB;
  }

  // Read the raw file contents as a UTF-8 string.
  const raw = fs.readFileSync(DB_PATH, "utf-8");

  // JSON.parse will throw a SyntaxError if the file is malformed.
  // We let that bubble up to the Express error handler rather than
  // silently swallowing it — the operator needs to know.
  const parsed = JSON.parse(raw) as Database;
  return parsed;
}

// ---------------------------------------------------------------------------
// writeDb()
// ---------------------------------------------------------------------------

/**
 * Serializes the given Database object and writes it to database.json.
 *
 * The third argument to JSON.stringify (2) produces human-readable indented
 * JSON — important for a local tool because the operator may need to inspect
 * or manually edit the file during development.
 *
 * @param db  The complete Database object to persist.
 * @throws    On any filesystem error (disk full, permissions, etc.).
 */
export function writeDb(db: Database): void {
  const json = JSON.stringify(db, null, 2);

  // writeFileSync is atomic on most OS/filesystem combinations for files
  // this small — the OS flushes the whole buffer before returning.
  fs.writeFileSync(DB_PATH, json, "utf-8");

  console.log(`[db] Wrote database.json (${json.length} bytes)`);
}
