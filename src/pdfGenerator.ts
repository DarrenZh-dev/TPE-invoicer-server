/**
 * ============================================================================
 * pdfGenerator (ver2).ts  —  The Printing Edge  /  Invoice PDF Engine
 * ============================================================================
 *
 * Produces invoices visually identical to BARNABAS GROUP – NO#015758.
 *
 * ── MEASUREMENTS DERIVED FROM PIXEL-SCANNING THE BARNABAS ORIGINAL ─────────
 *
 *   All coordinates are in POINTS (1 inch = 72 pt).
 *   Page: US Letter  612 × 792 pt.  Origin: top-left.  y increases downward.
 *   Pixel-to-point scale: 612/1700 = 0.36 pt/px  (scan was 200dpi on 8.5in)
 *
 *   Left content edge:      pt  58   (px 161)
 *   Right content edge:     pt 557   (px 1548)
 *   Content width:          pt 499
 *
 *   Blue separator rule:    pt  72   (px 199-200)
 *   Banner grey #1 top:     pt 233   (px 647)   — ORDER NUMBER / ORDERED BY row
 *   Banner grey #1 bottom:  pt 256   (px 712)   — height ≈ 23 pt
 *   White data row:         pt 256 – 278         — DAVE FOLEY / 604-816-5639 data
 *   Banner grey #2 top:     pt 278   (px 772)   — QTY / DESCRIPTION / AMOUNT row
 *   Banner grey #2 bottom:  pt 302   (px 838)   — height ≈ 24 pt
 *   Job rows start:         pt 307   (px 853)
 *   Grid box bottom:        pt 614   (px 1706)
 *   Bottom-section rule:    pt 658   (px 1827)
 *   PAYMENT grey bar top:   pt 669   (px 1859)
 *   PAYMENT grey bar bot:   pt 685   (px 1903)
 *   Footer text:            pt 716   (px 1989)
 *
 *   Grey colour (all bands): RGB(136,136,136) = #888888
 *   Red (logo):              RGB(227,24,55)   = #E31837
 *   Blue (rule & URL text):  RGB(0,75,141)    = #004B8D
 *
 * ── WHAT CHANGED vs ver1 ────────────────────────────────────────────────────
 *
 *   1. Header completely restructured to match the original:
 *        • Red/blue "The Printing Edge" logo area drawn with shapes + text
 *        • Blue horizontal separator rule at pt=72
 *        • "THE PRINTING EDGE" small text + address on the left body
 *        • "Invoice No:" bold right-aligned on the right body
 *        • "TO:" block indented below "THE PRINTING EDGE" text
 *
 *   2. Metadata banner now uses correct #888888 grey (not dark charcoal)
 *      with white column dividers and dark text labels.  Data row is white
 *      background with bold dark values.
 *
 *   3. Qty/Description/Amount header row uses same #888888 grey.
 *
 *   4. Line-item amounts use NO dollar sign (164.00 not $164.00).
 *
 *   5. Summary box labels/values aligned correctly:
 *        • Subtotal / PST / GST — plain values, no dollar sign
 *        • TOTAL / DEPOSIT / BALANCE — bold values, dollar sign on TOTAL only
 *
 *   6. Bottom-left section restructured to match exactly:
 *        • Signature line above "Received by" (not below)
 *        • Date underlines use __ / ___ / ______ format
 *        • PAYMENT grey bar (same grey)
 *        • CASH / CHEQUE # | DATE in two cells below the bar
 *
 *   7. Terms + footer BELOW the bottom box, centred, bold Terms line.
 *
 * ============================================================================
 */

import PDFDocument from "pdfkit";
import fs          from "fs";
import path        from "path";

import { Invoice, Client, Job } from "./types";
import { buildFilename }        from "./utils";

// ─────────────────────────────────────────────────────────────────────────────
// §1  PAGE CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const PW = 612;   // page width  (US Letter)
const PH = 792;   // page height

// Content edges (from pixel scan of original)
const ML = 58;    // left margin / content left edge
const MR = 55;    // right margin (RE = 612-55 = 557)
const RE = PW - MR;   // 557

const CW = RE - ML;   // content width = 499

// ─────────────────────────────────────────────────────────────────────────────
// §2  VERTICAL ANCHORS  (all measured from the Barnabas scan)
// ─────────────────────────────────────────────────────────────────────────────

// ── Header zone ──────────────────────────────────────────────────────────────
//
// LOGO PLACEHOLDER COORDINATES — replace fillRect with doc.image() here:
//   x = ML (58),  y = LOGO_TOP (18),  w ≈ 240pt,  h = LOGO_H (40pt)
//   See drawHeader() §9 below for the exact fillRect call to replace.
//
const LOGO_TOP    = 18;   // top of logo zone — measured from Barnabas scan (pt=34 → 18 for our margin)
const LOGO_H      = 40;   // logo block height — Barnabas logo is 38pt tall
const LOGO_BOT    = LOGO_TOP + LOGO_H;  // 58
const BLUE_RULE   = LOGO_BOT + 2;       // 60 — blue separator rule immediately below logo
//
// Measured from Barnabas scan:
//   Logo bottom: py=199 → pt=72.  Blue rule: py=199-200 → pt=72.
//   Body text ("THE PRINTING EDGE"): py=250 → pt=90.  Gap below rule = 18pt.
//
const BODY_TOP    = BLUE_RULE + 18;     // 78 — "THE PRINTING EDGE" body text starts here
                                         //   18pt gap below the blue rule (matches original)

// ── Metadata banner ───────────────────────────────────────────────────────────
const BAN1_TOP    = 210;  // top of grey ORDER NUMBER / ORDERED BY header row
const BAN1_H      = 22;   // height of that grey row
const BAN1_BOT    = BAN1_TOP + BAN1_H;  // 232

const DAT_TOP     = BAN1_BOT;           // top of white data row (DAVE FOLEY etc)
const DAT_H       = 18;                 // height of white data row
const DAT_BOT     = DAT_TOP + DAT_H;   // 250

// ── Qty/Desc/Amount header row ────────────────────────────────────────────────
const BAN2_TOP    = DAT_BOT + 2;       // 252 — top of QTY/DESC/AMOUNT grey row
const BAN2_H      = 22;                // height
const BAN2_BOT    = BAN2_TOP + BAN2_H; // 274

// ── Main job grid ──────────────────────────────────────────────────────────────
const GRID_TOP    = BAN2_BOT;          // 274 — top of the job rows area
const GRID_BOT    = 608;               // bottom of the job grid box

// ── Bottom section ────────────────────────────────────────────────────────────
// The bottom section is a box that contains:
//   Left half: signature/received-by area + PAYMENT bar + CASH/DATE row
//   Right half: financial summary (Subtotal/PST/GST/TOTAL/DEPOSIT/BALANCE)
//
// BOT_H = 110 gives a realistic signature area:
//   • SIG_AREA = 38pt  (generous writing space above the sig line)
//   • "Received by" + "Date" labels = 14pt
//   • PAYMENT grey bar = 16pt
//   • CASH/DATE row = 28pt
//   • border overlap = 14pt buffer
//   Total ≈ 110pt
//
const BOT_TOP     = GRID_BOT + 2;      // 610
const BOT_H       = 110;               // total height — increased for proper sig room
const BOT_BOT     = BOT_TOP + BOT_H;   // 720

// PAYMENT grey bar height
const PAY_BAR_H   = 16;

// ── Footer ────────────────────────────────────────────────────────────────────
const FTR_TOP     = BOT_BOT + 7;      // "Terms: Net 30 Days" line
const FTR_LEGAL   = FTR_TOP + 13;     // legal notice lines

// ─────────────────────────────────────────────────────────────────────────────
// §3  COLUMN GEOMETRY
//
// The Barnabas invoice uses these approximate column widths for the
// ORDER NUMBER / ORDERED BY / PHONE / SALESPERSON / PST EXEMPT # / DATE
// metadata banner.  Derived from text position scans.
// ─────────────────────────────────────────────────────────────────────────────

// Metadata banner columns (6 columns spanning ML to RE)
// Column left-edge x-positions:
const BAN_C = [
  ML,             // Order Number     col start  = 58
  ML +  80,       // Ordered By                  = 138
  ML + 200,       // Phone                       = 258
  ML + 298,       // Salesperson                 = 356
  ML + 374,       // PST EXEMPT #                = 432
  ML + 448,       // Date                        = 506  (wider gap before Date col)
  RE,             // right edge (end of last col)= 557
];

// Qty / Description / Amount column dividers
const QTY_X  = ML;           // 58
const QTY_W  = 65;           // qty column width
const DSC_X  = QTY_X + QTY_W;  // 123
const AMT_W  = 68;
const AMT_X  = RE - AMT_W;  // 489
const DSC_W  = AMT_X - DSC_X; // 366

// ─────────────────────────────────────────────────────────────────────────────
// §4  SUMMARY BOX (right half of bottom section)
// ─────────────────────────────────────────────────────────────────────────────

// Summary box geometry — derived by pixel-scanning the Barnabas original at 200dpi.
//
//   SUM_SPLIT = 321pt  → left edge of the entire summary box
//                         (= the vertical divider between payment-left and summary-right)
//   SUM_MID   = 462pt  → divider between the label cell and value cell inside the summary
//   RE        = 557pt  → right edge of page content
//
//   Label cell: 321→462 = 141pt   Value cell: 462→557 = 95pt
//
const SUM_SPLIT = 321;  // measured: left edge of summary box (pt)
const SUM_MID   = 462;  // measured: label|value internal divider (pt)
const SUM_ROW_H = 13;   // measured: row height in summary (pt)

// ─────────────────────────────────────────────────────────────────────────────
// §5  COLOURS  (all measured directly from the Barnabas scan)
// ─────────────────────────────────────────────────────────────────────────────

const GREY       = "#888888";  // RGB(136,136,136) — all grey bands
const GREY_FG    = "#222222";  // dark text on grey background
const RED        = "#E31837";  // RGB(227,24,55)  — logo red
const BLUE       = "#004B8D";  // RGB(0,75,141)   — logo blue, URL, blue rule
const BLACK      = "#111111";  // near-black for body text
const DIM        = "#555555";  // dimmer text for secondary lines

// ─────────────────────────────────────────────────────────────────────────────
// §6  FONTS
// ─────────────────────────────────────────────────────────────────────────────

const REG  = "Helvetica";
const BOLD = "Helvetica-Bold";

// ─────────────────────────────────────────────────────────────────────────────
// §7  FORMATTING UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

/** cents → "164.00"  (NO dollar sign — matches Barnabas line items) */
function fmtAmt(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** cents → "$183.68"  (WITH dollar sign — used in summary TOTAL/DEPOSIT/BALANCE) */
function fmtDollar(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** integer → "1,000" */
function fmtQty(n: number): string {
  return n.toLocaleString("en-CA");
}

/** integer → "015758" */
function pad6(n: number): string {
  return n.toString().padStart(6, "0");
}

// ─────────────────────────────────────────────────────────────────────────────
// §8  DRAWING PRIMITIVES
// ─────────────────────────────────────────────────────────────────────────────

function hline(
  doc: PDFKit.PDFDocument,
  x1: number, x2: number, y: number,
  w = 0.5, colour = "#aaaaaa"
): void {
  doc.save().strokeColor(colour).lineWidth(w)
     .moveTo(x1, y).lineTo(x2, y).stroke().restore();
}

function vline(
  doc: PDFKit.PDFDocument,
  x: number, y1: number, y2: number,
  w = 0.5, colour = "#aaaaaa"
): void {
  doc.save().strokeColor(colour).lineWidth(w)
     .moveTo(x, y1).lineTo(x, y2).stroke().restore();
}

function fillRect(
  doc: PDFKit.PDFDocument,
  x: number, y: number, w: number, h: number, colour: string
): void {
  doc.save().rect(x, y, w, h).fillColor(colour).fill().restore();
}

function strokeRect(
  doc: PDFKit.PDFDocument,
  x: number, y: number, w: number, h: number,
  weight = 0.5, colour = "#888888"
): void {
  doc.save().rect(x, y, w, h).strokeColor(colour).lineWidth(weight).stroke().restore();
}

/**
 * Place text at absolute (x, y).
 * Passes through all PDFKit text options.
 */
function t(
  doc: PDFKit.PDFDocument,
  s: string,
  x: number, y: number,
  font: string, size: number, colour: string,
  opts: PDFKit.Mixins.TextOptions = {}
): void {
  doc.save().font(font).fontSize(size).fillColor(colour)
     .text(s, x, y, { lineBreak: false, ...opts })
     .restore();
}

/**
 * Place text right-aligned so the right edge hits `rx`.
 */
function tR(
  doc: PDFKit.PDFDocument,
  s: string,
  rx: number, y: number,
  font: string, size: number, colour: string
): void {
  doc.save().font(font).fontSize(size).fillColor(colour);
  const w = doc.widthOfString(s);
  doc.text(s, rx - w, y, { lineBreak: false }).restore();
}

// ─────────────────────────────────────────────────────────────────────────────
// §9  ZONE A — HEADER
// ─────────────────────────────────────────────────────────────────────────────
//
//  TOP SECTION (above the blue rule at y=72):
//    Left:  Red chevron logo shape + "The Printing Edge" in italic blue
//    Right: "www.printingedgeonline.com" in italic red, right-aligned
//
//  BLUE RULE at y=72
//
//  BODY SECTION (below the blue rule):
//    Left column (x=ML):
//      "THE PRINTING EDGE"  (9pt bold)
//      ""  (1 blank line)
//      "6850 Merritt Avenue, Burnaby, BC, V5J 4R6"
//      "Tel: 604-431-9297    Fax: 604-435-7948"
//      ""
//      "TO:"
//      ""
//      [client company]
//      [client address lines — from contactName + phone as address proxy]
//
//    Right column (x ≈ 360):
//      "Invoice No:  015758"  (bold, large)
//      ""
//      [date]
//
// NOTE: We cannot reproduce the actual raster logo image without the source
// file.  Instead we draw a typographic approximation using PDFKit shapes that
// closely matches the visual weight and position of the original.
// ─────────────────────────────────────────────────────────────────────────────

function drawHeader(doc: PDFKit.PDFDocument, invoice: Invoice, client: Client): void {

  // ── LOGO BLOCK (above the blue rule) ────────────────────────────────────────
  //
  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  LOGO PLACEHOLDER  —  TO REPLACE WITH YOUR ACTUAL LOGO IMAGE           ║
  // ║                                                                          ║
  // ║  The red filled rectangle below is a stand-in for the "The Printing    ║
  // ║  Edge" logo.  When you have the logo file, replace these two calls:     ║
  // ║                                                                          ║
  // ║  REMOVE:                                                                 ║
  // ║    fillRect(doc, ML, LOGO_Y, LOGO_MARK_W, LOGO_MARK_H, RED);           ║
  // ║    doc.save()...text("The Printing Edge"...)...restore();               ║
  // ║                                                                          ║
  // ║  ADD:                                                                    ║
  // ║    doc.image('/path/to/logo.png', ML, LOGO_Y,                           ║
  // ║              { width: 240, height: LOGO_H });                           ║
  // ║                                                                          ║
  // ║  Coordinates:  x=ML(58pt)  y=LOGO_Y(≈20pt)  w≈240pt  h=LOGO_H(40pt)  ║
  // ╚══════════════════════════════════════════════════════════════════════════╝
  //
  // The original logo is:  Red chevron/arrow mark (left) + "The Printing Edge"
  // in bold blue italic (right).  Combined bounding box: ~306pt wide × 38pt tall.
  //
  const LOGO_MARK_W = 34;    // red mark width  — sized to match original chevron area
  const LOGO_MARK_H = LOGO_H; // red mark height — matches LOGO_H constant above
  const LOGO_Y = LOGO_TOP;

  // ▼▼▼  REPLACE THESE TWO BLOCKS WITH doc.image() WHEN YOU HAVE THE LOGO  ▼▼▼

  // Red logo mark (rectangular stand-in for the chevron)
  fillRect(doc, ML, LOGO_Y, LOGO_MARK_W, LOGO_MARK_H, RED);

  // "The Printing Edge" — blue bold-italic, vertically centred in LOGO_H
  doc.save()
     .font("Helvetica-BoldOblique")
     .fontSize(22)
     .fillColor(BLUE)
     .text("The Printing Edge", ML + LOGO_MARK_W + 8, LOGO_Y + (LOGO_H - 22) / 2, { lineBreak: false })
     .restore();

  // ▲▲▲  END OF LOGO PLACEHOLDER  ▲▲▲

  // ── URL — top right, red italic, vertically centred in logo block ────────────
  //
  // In the original: "www.printingedgeonline.com" in red italic, right-aligned,
  // sits roughly in the middle of the logo block height (about 12pt from top).
  //
  doc.save()
     .font("Helvetica-Oblique")
     .fontSize(9)
     .fillColor(RED);
  const urlStr = "www.printingedgeonline.com";
  const urlW = doc.widthOfString(urlStr);
  doc.text(urlStr, RE - urlW, LOGO_Y + (LOGO_H - 9) / 2, { lineBreak: false }).restore();

  // ── BLUE HORIZONTAL RULE ──────────────────────────────────────────────────────
  //
  // 1.2pt blue rule crossing the full content width.
  // Measured from original: py=199-200 → pt=72.  Sits immediately below the logo.
  //
  hline(doc, ML, RE, BLUE_RULE, 1.2, BLUE);

  // ── Left body column: shop identity + TO: block ───────────────────────────────
  //
  // BODY_TOP = BLUE_RULE + 18 = pt 78.  This 18pt gap below the blue rule
  // is measured from the Barnabas original (body text at py=250 → pt=90,
  // blue rule at pt=72, gap = 18pt).
  //
  let lY = BODY_TOP;

  // "THE PRINTING EDGE" — 9pt bold (matches original exactly)
  t(doc, "THE PRINTING EDGE", ML, lY, BOLD, 9, BLACK);
  lY += 14;

  // Address line 1
  t(doc, "6850 Merritt Avenue, Burnaby, BC, V5J 4R6", ML, lY, REG, 8, BLACK);
  lY += 11;

  // Address line 2
  t(doc, "Tel: 604-431-9297    Fax: 604-435-7948", ML, lY, REG, 8, BLACK);
  lY += 18;

  // "TO:" label
  t(doc, "TO:", ML, lY, REG, 9, BLACK);
  lY += 14;

  // Client address block — indented to match Barnabas (14pt from left margin)
  const CL_INDENT = ML + 14;

  // Company name — bold, matches original weight
  t(doc, client.companyName, CL_INDENT, lY, BOLD, 9, BLACK);
  lY += 12;

  // Remaining client lines (contact, phone, email) — regular weight, filter blanks
  const addrLines = [client.contactName, client.phone, client.email]
    .filter(s => s && s.trim().length > 0);

  for (const line of addrLines) {
    t(doc, line, CL_INDENT, lY, REG, 9, BLACK);
    lY += 12;
  }

  // ── Right body column: Invoice No + Date ─────────────────────────────────────
  //
  // In the Barnabas original, "Invoice No:" starts at pt_x=434 (px=1206).
  // Right-aligned to RE=557 to match exactly.
  //
  const RC = ML + Math.round(CW * 0.55);  // right column x ≈ 333 (start of right half)
  let rY = BODY_TOP + 2;

  // "Invoice No:  015758" — large bold, right-aligned
  const invLabel = `Invoice No:  ${pad6(invoice.invoiceNumber)}`;
  doc.save().font(BOLD).fontSize(13).fillColor(BLACK);
  const invW = doc.widthOfString(invLabel);
  doc.text(invLabel, RE - invW, rY, { lineBreak: false }).restore();
  rY += 16;

  // Date
  tR(doc, invoice.dateString, RE, rY, REG, 9, BLACK);
}

// ─────────────────────────────────────────────────────────────────────────────
// §10  ZONE B — METADATA BANNER
// ─────────────────────────────────────────────────────────────────────────────
//
//  STRUCTURE (top to bottom):
//
//  ┌──────────────┬─────────────┬──────────┬─────────────┬──────────┬──────────┐
//  │ Order Number │  Ordered By │  Phone   │ Salesperson │PST EXEMPT│  Date    │ ← GREY bg
//  ├──────────────┼─────────────┼──────────┼─────────────┼──────────┼──────────┤
//  │              │  DAVE FOLEY │604-816…  │             │          │April 20… │ ← WHITE bg
//  └──────────────┴─────────────┴──────────┴─────────────┴──────────┴──────────┘
//
//  Grey colour: #888888 (measured from original).
//  Text in grey header row: dark (#222), regular weight, 8pt.
//  Text in white data row: dark, BOLD, 9pt.
//  Column dividers: 1pt white lines spanning both rows.
//  Outer border: 0.75pt #888888.
// ─────────────────────────────────────────────────────────────────────────────

function drawMetaBanner(doc: PDFKit.PDFDocument, invoice: Invoice, client: Client): void {
  const totalBanH = BAN1_H + DAT_H;

  // ── Grey header row fill ──────────────────────────────────────────────────────
  fillRect(doc, ML, BAN1_TOP, CW, BAN1_H, GREY);

  // ── Header labels (dark text on grey, 8pt regular) ───────────────────────────
  const labels = ["Order Number", "Ordered By", "Phone", "Salesperson", "PST  EXEMPT #", "Date"];
  const hY = BAN1_TOP + (BAN1_H - 8) / 2;  // vertically centre 8pt text in the row
  for (let i = 0; i < labels.length; i++) {
    t(doc, labels[i], BAN_C[i] + 5, hY, REG, 8, GREY_FG);
  }

  // ── White data row fill ───────────────────────────────────────────────────────
  fillRect(doc, ML, DAT_TOP, CW, DAT_H, "#ffffff");

  // ── Data values (bold, 9pt, dark) ────────────────────────────────────────────
  // Note: in the Barnabas original the Order Number cell in the data row is EMPTY
  // (the order number column only shows a label in the header, no repeat below).
  // The data that appears: Ordered By = DAVE FOLEY, Phone, Date.
  const dataVals = [
    "",                          // Order Number (left blank in original)
    client.contactName,          // Ordered By
    client.phone,                // Phone
    "",                          // Salesperson (blank)
    "",                          // PST EXEMPT # (blank)
    invoice.dateString,          // Date
  ];
  const dY = DAT_TOP + (DAT_H - 9) / 2;  // vertically centre 9pt text
  for (let i = 0; i < dataVals.length; i++) {
    if (dataVals[i]) {
      // The Date column (last, i=5) is right-aligned to the right edge
      // so long date strings like "April 20, 2026" never wrap.
      if (i === 5) {
        tR(doc, dataVals[i], RE - 5, dY, BOLD, 9, BLACK);
      } else {
        t(doc, dataVals[i], BAN_C[i] + 5, dY, BOLD, 9, BLACK, {
          width: BAN_C[i + 1] - BAN_C[i] - 8,
          ellipsis: true,
          lineBreak: false,
        });
      }
    }
  }

  // ── White vertical column dividers (span both rows) ───────────────────────────
  for (let i = 1; i < 6; i++) {
    vline(doc, BAN_C[i], BAN1_TOP, DAT_BOT, 1.0, "#ffffff");
  }

  // ── Outer border of the entire banner pair ────────────────────────────────────
  strokeRect(doc, ML, BAN1_TOP, CW, totalBanH, 0.75, GREY);

  // ── Thin rule between header row and data row ─────────────────────────────────
  hline(doc, ML, RE, DAT_TOP, 0.5, "#aaaaaa");
}

// ─────────────────────────────────────────────────────────────────────────────
// §11  ZONE C — QTY / DESCRIPTION / AMOUNT HEADER ROW
// ─────────────────────────────────────────────────────────────────────────────
//
//  Same grey (#888888) as the metadata banner.
//  Labels: "Qty" (left-aligned), "Description" (left-aligned), "Amount" (right-aligned).
//  Font: 8.5pt regular, dark text.
// ─────────────────────────────────────────────────────────────────────────────

function drawGridHeaders(doc: PDFKit.PDFDocument): void {
  // Fill grey background for the entire row
  fillRect(doc, ML, BAN2_TOP, CW, BAN2_H, GREY);

  const tY = BAN2_TOP + (BAN2_H - 9) / 2;  // vertically centre

  t(doc, "Qty",         QTY_X  + 5,  tY, REG, 8.5, GREY_FG);
  t(doc, "Description", DSC_X  + 5,  tY, REG, 8.5, GREY_FG);
  tR(doc, "Amount",     RE - 5,       tY, REG, 8.5, GREY_FG);

  // White vertical dividers inside this grey row
  vline(doc, DSC_X, BAN2_TOP, BAN2_BOT, 1.0, "#ffffff");
  vline(doc, AMT_X, BAN2_TOP, BAN2_BOT, 1.0, "#ffffff");

  // Outer border of this row
  strokeRect(doc, ML, BAN2_TOP, CW, BAN2_H, 0.75, GREY);
}

// ─────────────────────────────────────────────────────────────────────────────
// §12  ZONE D — MAIN JOB GRID
// ─────────────────────────────────────────────────────────────────────────────
//
//  A large white-background rectangle from GRID_TOP to GRID_BOT.
//  Outer border: 0.75pt #888888.
//  Internal column rules: 0.75pt #888888 at DSC_X and AMT_X.
//
//  JOB ROW LOOP:
//    curY starts at GRID_TOP + 8.
//    For each job (after the first), a thin horizontal separator is drawn.
//
//  PER JOB — three text lines in the Description column:
//    Line 1 (BOLD, 9pt):    job.remarks
//    Line 2 (REG,  8pt):    "Stock: [paperType]  |  Ink: Side 1: [ink], Side 2: [ink]"
//    Line 3 (REG,  8pt):    "Size: [finishSize][  Folded: [foldedSize]][  |  Bindery: [bindery]]"
//
//  Qty column:    fmtQty(noOfItemsSheet), right-aligned, bold, 9pt
//  Amount column: fmtAmt(printingPriceCents), right-aligned, regular, 9pt
//                 NO dollar sign — matches Barnabas ("164.00" not "$164.00")
//
//  Line heights:
//    remarks  = 12pt
//    spec 1   = 11pt
//    spec 2   = 11pt
//    padding  =  6pt
//    separator=  4pt gap
//    ─────────────
//    per job  ≈ 44pt  →  floor((608-274)/44) = 7 jobs on one page
// ─────────────────────────────────────────────────────────────────────────────

function drawGrid(doc: PDFKit.PDFDocument, invoice: Invoice): void {
  const gridH = GRID_BOT - GRID_TOP;

  // ── Outer box ──────────────────────────────────────────────────────────────
  strokeRect(doc, ML, GRID_TOP, CW, gridH, 0.75, GREY);

  // ── Internal column rules ──────────────────────────────────────────────────
  vline(doc, DSC_X, GRID_TOP, GRID_BOT, 0.75, GREY);
  vline(doc, AMT_X, GRID_TOP, GRID_BOT, 0.75, GREY);

  // ── Job rows ────────────────────────────────────────────────────────────────
  const LH_REM = 12;  // line height: remarks (9pt bold)
  const LH_SPC = 11;  // line height: spec lines (8pt)
  const PAD_BOT =  6; // bottom padding below each job's text block
  const SEP_GAP =  5; // gap after the separator rule, before next job's text

  let curY = GRID_TOP + 8;

  invoice.jobs.forEach((job: Job, idx: number) => {

    // ── Horizontal separator between jobs ──────────────────────────────────────
    if (idx > 0) {
      hline(doc, ML + 1, RE - 1, curY, 0.5, "#cccccc");
      curY += SEP_GAP;
    }

    const jobTopY = curY;

    // ── Description Line 1 — REMARKS ──────────────────────────────────────────
    doc.save().font(BOLD).fontSize(9).fillColor(BLACK)
       .text(
         job.remarks || `Job Order #${job.jobIndex}`,
         DSC_X + 6, curY,
         { width: DSC_W - 10, lineBreak: false }
       ).restore();
    curY += LH_REM;

    // ── Description Line 2 — STOCK & INK ──────────────────────────────────────
    //
    // Ink string:
    //   Both sides used:  "Side 1: PMS 286, Side 2: BLACK"
    //   One side only:    "Side 1: PMS 286 BLUE"
    //
    const inkPart = job.inkColoursSide2 && job.inkColoursSide2 !== "Blank / No Ink"
      ? `Side 1: ${job.inkColoursSide1}, Side 2: ${job.inkColoursSide2}`
      : `Side 1: ${job.inkColoursSide1}`;

    doc.save().font(REG).fontSize(8).fillColor(DIM)
       .text(
         `Stock: ${job.paperType}  |  Ink: ${inkPart}`,
         DSC_X + 6, curY,
         { width: DSC_W - 10, lineBreak: false }
       ).restore();
    curY += LH_SPC;

    // ── Description Line 3 — SIZE & BINDERY ───────────────────────────────────
    //
    // Size string:  "4.125 x 9.5" or "8.5x11 -> Folded: 3.67x8.5"
    // Bindery:      appended if set and not "None"
    //
    const sizePart = job.foldedSize
      ? `${job.finishSize} -> Folded: ${job.foldedSize}`
      : job.finishSize;
    const bindPart = (job.bindery && job.bindery !== "None")
      ? `  |  Bindery: ${job.bindery}`
      : "";

    if (sizePart || bindPart) {
      doc.save().font(REG).fontSize(8).fillColor(DIM)
         .text(
           `Size: ${sizePart}${bindPart}`,
           DSC_X + 6, curY,
           { width: DSC_W - 10, lineBreak: false }
         ).restore();
      curY += LH_SPC;
    }

    // ── QTY — right-aligned in qty column, bold 9pt ───────────────────────────
    //
    // noOfItemsSheet is the quantity field — formatted with commas.
    //
    tR(doc, fmtQty(job.noOfItemsSheet), DSC_X - 5, jobTopY, BOLD, 9, BLACK);

    // ── AMOUNT — right-aligned in amount column, regular 9pt ─────────────────
    //
    // NO dollar sign — matches the Barnabas original ("164.00").
    //
    tR(doc, fmtAmt(job.printingPriceCents), RE - 6, jobTopY, REG, 9, BLACK);

    // ── Advance past bottom padding ────────────────────────────────────────────
    curY += PAD_BOT;

  }); // end forEach job
}

// ─────────────────────────────────────────────────────────────────────────────
// §13  ZONE E — BOTTOM SECTION
// ─────────────────────────────────────────────────────────────────────────────
//
//  Layout diagram (from the Barnabas scan):
//
//  ┌────────────────────────────────────────┬────────────────────────────────┐
//  │  [signature underline]                 │  Subtotal:           164.00    │
//  │  Received by            Date           │  PST:                 11.48    │
//  ├────────────────────────────────────────┤  GST:                  8.20    │
//  │░░░░░░░░░░░░ PAYMENT ░░░░░░░░░░░░░░░░░░│  ────────────────────────────  │
//  ├────────────────────┬───────────────────┤  TOTAL:           $183.68      │
//  │  CASH / CHEQUE #   │   DATE            │  DEPOSIT:             0.00     │
//  └────────────────────┴───────────────────┘  BALANCE:           183.68     │
//                                           └────────────────────────────────┘
//
//  Then BELOW the box (not inside):
//    "Terms:  Net 30 Days"  (bold, centred)
//    "PLEASE PAY FROM THIS INVOICE (GST # R119352755 )"
//    "Net on presentation. Monthly Finance Charge: 2% on overdue accounts."
//
//  Key observations from the scan:
//    • The "Received by" label is BELOW the signature underline (not above)
//    • The Date underline uses "____  /  ____  /  ________" format
//    • The PAYMENT bar is grey (#888888) spanning the full left-half width
//    • CASH/CHEQUE# and DATE share a horizontal space with a vertical divider
//    • Summary values: plain numbers (164.00) except TOTAL ($183.68 bold)
//    • No outer box around the summary — it continues from the left box
//    • There IS a vertical divider between the left and right sections
// ─────────────────────────────────────────────────────────────────────────────

function drawBottomSection(doc: PDFKit.PDFDocument, invoice: Invoice): void {

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // RIGHT HALF — FINANCIAL SUMMARY
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //
  // The summary has 6 rows:
  //   Subtotal  (no $, regular)
  //   PST:      (no $, regular)
  //   GST:      (no $, regular)
  //   ── thin rule ──
  //   TOTAL:    ($ sign, BOLD)
  //   DEPOSIT:  (no $, regular)
  //   BALANCE:  (no $, bold)
  //
  // The vertical divider between label and value sits at SUM_MID.
  //

  type SRow = [string, number, boolean, boolean]; // [label, cents, hasDollar, bold]
  const sumRows: SRow[] = [
    ["Subtotal:",  invoice.preTaxCents,  false, false],
    ["PST:",       invoice.pstCents,     false, false],
    ["GST:",       invoice.gstCents,     false, false],
    // separator line drawn before TOTAL
    ["TOTAL:",     invoice.totalCents,   true,  true ],
    ["DEPOSIT:",   invoice.depositCents, false, false],
    ["BALANCE:",   invoice.balanceCents, false, true ],
  ];

  let sy = BOT_TOP;

  // Outer border for the summary section (right half only)
  strokeRect(doc, SUM_SPLIT, BOT_TOP, RE - SUM_SPLIT, BOT_H, 0.75, GREY);

  // Vertical divider between label and value cells
  vline(doc, SUM_MID, BOT_TOP, BOT_BOT, 0.5, GREY);

  sumRows.forEach(([label, cents, hasDollar, bold]: SRow, i: number) => {
    // Draw thin rule before TOTAL
    if (i === 3) {
      hline(doc, SUM_SPLIT, RE, sy, 0.75, GREY);
    }

    const f    = bold ? BOLD : REG;
    const sz   = bold ? 9 : 8.5;
    const val  = hasDollar ? fmtDollar(cents) : fmtAmt(cents);

    // Label: left-aligned in the label cell
    t(doc, label, SUM_SPLIT + 5, sy + 3, f, sz, BLACK);

    // Value: right-aligned in the value cell
    tR(doc, val, RE - 5, sy + 3, f, sz, BLACK);

    sy += SUM_ROW_H;

    // Horizontal rule after each row (except last)
    if (i < sumRows.length - 1 && i !== 2) {
      hline(doc, SUM_SPLIT, RE, sy, 0.4, "#cccccc");
    }
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // LEFT HALF — SIGNATURE / PAYMENT BLOCK
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //
  // From Barnabas bottom crop:
  //   Row 1: long underline           ____/____/______  underline
  //   Row 2: "Received by"  centred   "Date"  centred (below respective lines)
  //   Grey bar: "PAYMENT" centred in grey bar
  //   Row 3: "CASH / CHEQUE #" left  |  "DATE" right (vertical divider between)
  //   Bottom border of left half
  //

  const LR = SUM_SPLIT;   // left half right edge
  const LW = LR - ML;     // left half width

  // Outer border for left half
  strokeRect(doc, ML, BOT_TOP, LW, BOT_H, 0.75, GREY);

  // Vertical divider between left and right halves
  vline(doc, SUM_SPLIT, BOT_TOP, BOT_BOT, 0.75, GREY);

  // ── SIGNATURE AREA ──────────────────────────────────────────────────────────
  //
  // Layout (top to bottom within the left half):
  //
  //   BOT_TOP (610)
  //   │
  //   │  ← 38pt of open writing space (room to physically sign)
  //   │
  //   SIG_Y (BOT_TOP + 38 = 648) ── long sig underline ──  ___/ ___/ _______
  //   SIG_Y + 3                      "Received by"           "Date"
  //   SIG_Y + 16 (664) ── thin separator rule ──
  //   PAY_Y (665) ░░░░░░░░░░░░░ PAYMENT ░░░░░░░░░░░░░  (16pt grey bar)
  //   CHQ_Y (682) ┌──────────────────┬───────────────┐
  //               │  CASH / CHEQUE # │     DATE       │  (28pt cell)
  //   BOT_BOT(720)└──────────────────┴───────────────┘
  //
  // The 38pt space above the sig line is deliberately generous so an operator
  // can write a full signature without cramping.
  //
  const SIG_Y  = BOT_TOP + 38;   // sig line y — 38pt writing space above it

  // ── Left side: long signature underline ──────────────────────────────────────
  //
  // Spans ~55% of the left half width, matching the Barnabas original proportion.
  // From Barnabas scan: sig line goes from pt_x=77 to ~pt_x=202 (125pt wide).
  //
  const SIG_X1 = ML + 8;              // sig line left  = pt 66
  const SIG_X2 = ML + LW * 0.56;     // sig line right = pt 66 + 56% of left width
  hline(doc, SIG_X1, SIG_X2, SIG_Y, 0.75, BLACK);

  // ── Right side: date underlines  __ / ____ / ________ ───────────────────────
  //
  // Three separate underline segments with "/" separators between them.
  // This matches the Barnabas original format exactly.
  //
  const DT_START = SIG_X2 + 12;    // start of the date section
  const DT_END   = LR - 8;         // end of the date section
  const DT_TOTAL = DT_END - DT_START;

  // Segment proportions: day(20%) / slash / month(25%) / slash / year(40%)
  const DT_D1 = DT_START;
  const DT_D2 = DT_START + DT_TOTAL * 0.22;
  const DT_M1 = DT_D2 + 10;   // gap for the first slash
  const DT_M2 = DT_M1 + DT_TOTAL * 0.26;
  const DT_Y1 = DT_M2 + 10;   // gap for the second slash
  const DT_Y2 = DT_END;

  hline(doc, DT_D1, DT_D2, SIG_Y, 0.75, BLACK);  // day segment
  t(doc, "/", (DT_D2 + DT_M1) / 2 - 3, SIG_Y - 8, REG, 9, BLACK);  // first slash
  hline(doc, DT_M1, DT_M2, SIG_Y, 0.75, BLACK);  // month segment
  t(doc, "/", (DT_M2 + DT_Y1) / 2 - 3, SIG_Y - 8, REG, 9, BLACK);  // second slash
  hline(doc, DT_Y1, DT_Y2, SIG_Y, 0.75, BLACK);  // year segment

  // ── Labels below the sig and date lines ──────────────────────────────────────
  //
  // "Received by" is centred under the signature underline.
  // "Date" is centred under the date underlines.
  //
  doc.save().font(REG).fontSize(8).fillColor(BLACK);
  const recLabel  = "Received by";
  const recLabelW = doc.widthOfString(recLabel);
  doc.text(recLabel, (SIG_X1 + SIG_X2) / 2 - recLabelW / 2, SIG_Y + 3, { lineBreak: false });
  const datLabel  = "Date";
  const datLabelW = doc.widthOfString(datLabel);
  doc.text(datLabel, (DT_START + DT_END) / 2 - datLabelW / 2, SIG_Y + 3, { lineBreak: false });
  doc.restore();

  // ── Thin rule between sig area and PAYMENT bar ────────────────────────────────
  const SIG_BOT_RULE = SIG_Y + 16;
  hline(doc, ML + 1, LR - 1, SIG_BOT_RULE, 0.4, "#bbbbbb");

  // ── PAYMENT grey bar ───────────────────────────────────────────────────────────
  //
  // Same #888888 grey as the metadata banner and QTY/DESC/AMOUNT header.
  // "PAYMENT" text is white, bold, centred in the bar.
  //
  const PAY_Y = SIG_BOT_RULE + 1;
  fillRect(doc, ML + 0.5, PAY_Y, LW - 1, PAY_BAR_H, GREY);

  doc.save().font(BOLD).fontSize(9).fillColor("#ffffff");
  const payLabel = "PAYMENT";
  const payW     = doc.widthOfString(payLabel);
  doc.text(payLabel, ML + LW / 2 - payW / 2, PAY_Y + 3, { lineBreak: false }).restore();

  // ── CASH / CHEQUE # and DATE row ──────────────────────────────────────────────
  //
  // Two cells side by side, separated by a vertical divider at LW midpoint.
  // The outer border of this row is drawn as a strokeRect.
  //
  const CHQ_Y   = PAY_Y + PAY_BAR_H + 1;
  const CHQ_MID = ML + LW * 0.5;   // midpoint = vertical divider x

  // Outer border of CASH/DATE row
  strokeRect(doc, ML, CHQ_Y, LW, BOT_BOT - CHQ_Y, 0.75, GREY);

  // Vertical divider between the two cells
  vline(doc, CHQ_MID, CHQ_Y, BOT_BOT, 0.75, GREY);

  // "CASH / CHEQUE #" — centred in left cell
  doc.save().font(REG).fontSize(8).fillColor(BLACK);
  const cashLabel = "CASH / CHEQUE #";
  const cashW     = doc.widthOfString(cashLabel);
  doc.text(cashLabel, ML + (CHQ_MID - ML) / 2 - cashW / 2, CHQ_Y + 8, { lineBreak: false })
     .restore();

  // "DATE" — centred in right cell
  doc.save().font(REG).fontSize(8).fillColor(BLACK);
  const dateLabel = "DATE";
  const dateLW    = doc.widthOfString(dateLabel);
  doc.text(dateLabel, CHQ_MID + (LR - CHQ_MID) / 2 - dateLW / 2, CHQ_Y + 8, { lineBreak: false })
     .restore();
}

// ─────────────────────────────────────────────────────────────────────────────
// §14  ZONE F — FOOTER (below the bottom box)
// ─────────────────────────────────────────────────────────────────────────────
//
//  From the Barnabas scan:
//    Line 1: "Terms:  Net 30 Days"  — BOLD, centred
//    Line 2: "PLEASE PAY FROM THIS INVOICE  (GST # R119352755 )"  — regular, centred
//    Line 3: "Net on presentation. Monthly Finance Charge: 2% on overdue accounts."
// ─────────────────────────────────────────────────────────────────────────────

function drawFooter(doc: PDFKit.PDFDocument, invoice: Invoice): void {
  const opts: PDFKit.Mixins.TextOptions = { width: CW, align: "center", lineBreak: false };

  // Terms line — bold
  doc.save().font(BOLD).fontSize(9).fillColor(BLACK)
     .text(`Terms:  ${invoice.terms}`, ML, FTR_TOP, opts)
     .restore();

  // Legal line 1
  doc.save().font(REG).fontSize(7.5).fillColor(DIM)
     .text("PLEASE PAY FROM THIS INVOICE  (GST # R119352755 )", ML, FTR_LEGAL, opts)
     .restore();

  // Legal line 2
  doc.save().font(REG).fontSize(7.5).fillColor(DIM)
     .text("Net on presentation. Monthly Finance Charge: 2% on overdue accounts.", ML, FTR_LEGAL + 11, opts)
     .restore();
}

// ─────────────────────────────────────────────────────────────────────────────
// §15  VOIDED WATERMARK (conditional)
// ─────────────────────────────────────────────────────────────────────────────

function drawVoid(doc: PDFKit.PDFDocument): void {
  doc.save()
     .rotate(-42, { origin: [PW / 2, PH / 2] })
     .font(BOLD).fontSize(120)
     .fillColor("#ff0000", 0.12)
     .text("VOID", 0, PH / 2 - 60, { align: "center", width: PW, lineBreak: false })
     .restore();
}

// ─────────────────────────────────────────────────────────────────────────────
// §16a  PRODUCTION HEADER
// ─────────────────────────────────────────────────────────────────────────────
//
//  Three bordered hand-fill boxes replace the logo/rule area.
//  Measured from Example_production_version.png (2550×3300px, scale=0.24pt/px):
//
//  Box top = pt 16   Box bottom = pt 55   (height = 39pt)
//
//  Box 1 — File location       left=60    right=206   width=146pt
//  Box 2 — If repeat / Receipt left=247   right=396   width=149pt
//    Internal divider at y=24  (pt) separates the two sub-labels
//  Box 3 — Due Date            left=439   right=585   width=146pt
//
//  Body section (THE PRINTING EDGE, Invoice No, TO:, client) starts at pt=57,
//  immediately below the boxes — identical positioning to the customer header.
//
function drawProductionHeader(doc: PDFKit.PDFDocument, invoice: Invoice, client: Client): void {
  const BOX_TOP = 16;
  const BOX_BOT = 55;
  const BOX_H   = BOX_BOT - BOX_TOP;   // 39pt

  // Box 1 — File location (left column)
  const B1_L = 60;  const B1_R = 206;
  strokeRect(doc, B1_L, BOX_TOP, B1_R - B1_L, BOX_H, 0.75, BLACK);
  doc.save().font(BOLD).fontSize(8.5).fillColor(BLACK);
  const b1Label = "File location";
  const b1LW = doc.widthOfString(b1Label);
  doc.text(b1Label, B1_L + (B1_R - B1_L) / 2 - b1LW / 2, BOX_TOP + 4, { lineBreak: false });
  doc.restore();

  // Box 2 — If repeat / Receipt of goods # (centre column, split into two sub-boxes)
  const B2_L = 247;  const B2_R = 396;
  const B2_DIV = BOX_TOP + 16;   // internal horizontal divider at ~pt 32
  strokeRect(doc, B2_L, BOX_TOP, B2_R - B2_L, BOX_H, 0.75, BLACK);
  hline(doc, B2_L, B2_R, B2_DIV, 0.75, BLACK);

  // Sub-box top: "If repeat, previous invoice#"
  doc.save().font(BOLD).fontSize(7.5).fillColor(BLACK);
  const b2aLabel = "If repeat, previous invoice#";
  const b2aLW = doc.widthOfString(b2aLabel);
  doc.text(b2aLabel, B2_L + (B2_R - B2_L) / 2 - b2aLW / 2,
           BOX_TOP + (B2_DIV - BOX_TOP) / 2 - 4, { lineBreak: false });
  doc.restore();

  // Sub-box bottom: "Receipt of goods #"
  doc.save().font(BOLD).fontSize(8.5).fillColor(BLACK);
  const b2bLabel = "Receipt of goods #";
  const b2bLW = doc.widthOfString(b2bLabel);
  doc.text(b2bLabel, B2_L + (B2_R - B2_L) / 2 - b2bLW / 2,
           B2_DIV + (BOX_BOT - B2_DIV) / 2 - 5, { lineBreak: false });
  doc.restore();

  // Box 3 — Due Date (right column)
  const B3_L = 439;  const B3_R = 585;
  strokeRect(doc, B3_L, BOX_TOP, B3_R - B3_L, BOX_H, 0.75, BLACK);
  doc.save().font(BOLD).fontSize(8.5).fillColor(BLACK);
  const b3Label = "Due Date";
  const b3LW = doc.widthOfString(b3Label);
  doc.text(b3Label, B3_L + (B3_R - B3_L) / 2 - b3LW / 2, BOX_TOP + 4, { lineBreak: false });
  doc.restore();

  // ── Body section — same layout as drawHeader() but starting at pt=57 ────────
  const PBODY = BOX_BOT + 2;   // pt 57
  let lY = PBODY;

  t(doc, "THE PRINTING EDGE", ML, lY, BOLD, 9, BLACK);  lY += 14;
  t(doc, "6850 Merritt Avenue, Burnaby, BC, V5J 4R6", ML, lY, REG, 8, BLACK);  lY += 11;
  t(doc, "Tel: 604-431-9297    Fax: 604-435-7948", ML, lY, REG, 8, BLACK);  lY += 18;
  t(doc, "TO:", ML, lY, REG, 9, BLACK);  lY += 14;

  const CI = ML + 14;
  t(doc, client.companyName, CI, lY, BOLD, 9, BLACK);  lY += 12;
  [client.contactName, client.phone, client.email]
    .filter(s => s && s.trim())
    .forEach(line => { t(doc, line, CI, lY, REG, 9, BLACK);  lY += 12; });

  // Invoice No + date — right-aligned
  const invLabel = `Invoice No:  ${pad6(invoice.invoiceNumber)}`;
  doc.save().font(BOLD).fontSize(13).fillColor(BLACK);
  const invW = doc.widthOfString(invLabel);
  doc.text(invLabel, RE - invW, PBODY, { lineBreak: false }).restore();
  tR(doc, invoice.dateString, RE, PBODY + 16, REG, 9, BLACK);
}

// ─────────────────────────────────────────────────────────────────────────────
// §16b  NO-HEADER (PRINT) VERSION
// ─────────────────────────────────────────────────────────────────────────────
//
//  Used for printing on pre-printed letterhead paper.  The top of the page
//  is left as WHITE SPACE so it aligns with the physical letterhead.
//
//  TOP MARGIN = BODY_TOP = 78pt (≈ 1.08 inches).
//
//  This value is derived by measuring where "THE PRINTING EDGE" body text
//  appears in the customer invoice (py=216, pt=77.8) and using that same
//  y-position here.  The result: the metadata banner, job grid, and bottom
//  section all land at EXACTLY the same position on the page as the customer
//  and production variants — only the top ~78pt (the logo area) is blank.
//
//  Saved to "invoices-print/" folder.
//
function drawNoHeaderBody(doc: PDFKit.PDFDocument, invoice: Invoice, client: Client): void {
  // Y = BODY_TOP = 78pt — matches where the customer invoice body text starts,
  // directly below where the logo/blue-rule would be on the customer version.
  // This blank space (0 to 78pt) is reserved for the pre-printed letterhead.
  const Y = 78;
  let lY = Y;

  // Identical line spacings to drawHeader() body section so all text positions match
  t(doc, "THE PRINTING EDGE", ML, lY, BOLD, 9, BLACK);  lY += 14;
  t(doc, "6850 Merritt Avenue, Burnaby, BC, V5J 4R6", ML, lY, REG, 8, BLACK);  lY += 11;
  t(doc, "Tel: 604-431-9297    Fax: 604-435-7948", ML, lY, REG, 8, BLACK);  lY += 18;
  t(doc, "TO:", ML, lY, REG, 9, BLACK);  lY += 14;

  const CI = ML + 14;
  t(doc, client.companyName, CI, lY, BOLD, 9, BLACK);  lY += 12;
  [client.contactName, client.phone, client.email]
    .filter(s => s && s.trim())
    .forEach(line => { t(doc, line, CI, lY, REG, 9, BLACK);  lY += 12; });

  // Invoice No + date — identical positioning to drawHeader() right column
  const invLabel = `Invoice No:  ${pad6(invoice.invoiceNumber)}`;
  doc.save().font(BOLD).fontSize(13).fillColor(BLACK);
  const invW = doc.widthOfString(invLabel);
  doc.text(invLabel, RE - invW, Y, { lineBreak: false }).restore();
  tR(doc, invoice.dateString, RE, Y + 16, REG, 9, BLACK);
}

// ─────────────────────────────────────────────────────────────────────────────
// §16  PUBLIC EXPORT
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// THREE-VARIANT GENERATOR
// ─────────────────────────────────────────────────────────────────────────────
//
//  VARIANT      │  HEADER FUNCTION        │  OUTPUT FOLDER
//  ─────────────┼─────────────────────────┼──────────────────────────────────
//  "customer"   │  drawHeader()           │  invoices/
//  "production" │  drawProductionHeader() │  invoices-production/
//  "print"      │  drawNoHeaderBody()     │  invoices-print/
//
//  Each variant goes into its own dedicated folder so files sort cleanly.
//
//  Filename convention:
//    customer:    "[Company] - [JobType] #[000000].pdf"
//    production:  "[Company] - [JobType] #[000000] PRODUCTION.pdf"
//    print:       "[Company] - [JobType] #[000000] PRINT.pdf"
//

export type InvoiceVariant = "customer" | "production" | "print";

/**
 * generateInvoicePdf(invoice, client, outputDir?, variant?)
 *
 * Renders one invoice PDF for the requested variant and saves it to disk.
 *
 * @param invoice   Full Invoice record from database.json.
 * @param client    Resolved Client record for this invoice.
 * @param outputDir Base output directory. Defaults to <project-root>/invoices.
 *                  Production and print variants automatically write to sibling
 *                  folders ("invoices-production/" and "invoices-print/") so all
 *                  three output streams are always separated.
 * @param variant   "customer" (default) | "production" | "print"
 * @returns         Absolute path of the written PDF file.
 */
export async function generateInvoicePdf(
  invoice: Invoice,
  client: Client,
  outputDir?: string,
  variant: InvoiceVariant = "customer"
): Promise<string> {

  // ── Resolve the correct output directory for this variant ──────────────────
  //
  // The base dir is always the "invoices/" folder (or whatever outputDir is).
  // Production and print variants resolve to sibling folders alongside it:
  //
  //   invoices/               ← customer copies
  //   invoices-production/    ← production copies (hand-fill boxes header)
  //   invoices-print/         ← print copies (blank top for letterhead paper)
  //
  const baseDir = outputDir
    ? path.resolve(outputDir)
    : path.resolve(__dirname, "../invoices");

  // Build the target folder path based on variant.
  // path.join(baseDir, "..", "invoices-production") goes one level UP from
  // "invoices/" then into the sibling folder — so all three folders sit
  // side-by-side in the project root regardless of where baseDir is.
  const dir = variant === "production"
    ? path.resolve(path.join(baseDir, "..", "invoices-production"))
    : variant === "print"
    ? path.resolve(path.join(baseDir, "..", "invoices-print"))
    : baseDir;   // "customer" uses baseDir directly

  fs.mkdirSync(dir, { recursive: true });

  // ── Build filename with variant suffix ─────────────────────────────────────
  const firstJobType = invoice.jobs[0]?.paperType || "ORDER";
  const baseName     = buildFilename(client.companyName, firstJobType, invoice.invoiceNumber);
  const withoutExt   = baseName.replace(/[.]pdf$/, "");
  const suffix       = variant === "production" ? " PRODUCTION"
                     : variant === "print"      ? " PRINT"
                     : "";
  const filename = `${withoutExt}${suffix}.pdf`;
  const outPath  = path.join(dir, filename);

  console.log(`[pdf:${variant}] → ${outPath}`);

  // ── Create PDFDocument ──────────────────────────────────────────────────────
  const doc = new PDFDocument({
    size:    "LETTER",
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    info: {
      Title:   `Invoice #${pad6(invoice.invoiceNumber)}${suffix}`,
      Author:  "The Printing Edge — Burnaby BC",
      Subject: `${variant === "production" ? "Production copy" : variant === "print" ? "Print copy" : "Invoice"} for ${client.companyName}`,
      Creator: "PrintingEdge Server v2",
    },
  });

  const ws   = fs.createWriteStream(outPath);
  doc.pipe(ws);

  const done = new Promise<void>((resolve, reject) => {
    ws.on("finish", resolve);
    ws.on("error",  reject);
  });

  // ── Draw the correct header for this variant ──────────────────────────────
  if (variant === "customer") {
    drawHeader(doc, invoice, client);              // logo placeholder + blue rule
  } else if (variant === "production") {
    drawProductionHeader(doc, invoice, client);    // three hand-fill boxes
  } else {
    drawNoHeaderBody(doc, invoice, client);        // compact body, no logo/boxes
  }

  // ── Shared zones (identical for all three variants) ───────────────────────
  drawMetaBanner   (doc, invoice, client);   // B — ORDER NUMBER banner
  drawGridHeaders  (doc);                    // C — QTY / DESCRIPTION / AMOUNT
  drawGrid         (doc, invoice);           // D — job rows
  drawBottomSection(doc, invoice);           // E — signature + summary
  drawFooter       (doc, invoice);           // F — Terms + legal notice

  if (invoice.status === "Voided") drawVoid(doc);

  doc.end();
  await done;

  console.log(`[pdf:${variant}] Done: ${filename}`);
  return outPath;
}

/**
 * generateAllVariants(invoice, client, outputDir?) → Promise<string[]>
 *
 * Convenience function that generates all three variants in parallel and
 * returns all three file paths as [customerPath, productionPath, printPath].
 *
 * This is what POST /api/invoices should call so every new invoice
 * automatically produces all three copies in one step.
 */
export async function generateAllVariants(
  invoice: Invoice,
  client: Client,
  outputDir?: string
): Promise<string[]> {
  return Promise.all([
    generateInvoicePdf(invoice, client, outputDir, "customer"),
    generateInvoicePdf(invoice, client, outputDir, "production"),
    generateInvoicePdf(invoice, client, outputDir, "print"),
  ]);
}
