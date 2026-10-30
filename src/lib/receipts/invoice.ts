import { createHash } from "node:crypto";
import type { BoundingBox, Extraction, ReceiptFixture } from "@/lib/domain/schemas";
import { normalizeExtraction } from "@/lib/domain/schemas";
import { centsToNumber, formatUsd } from "@/lib/domain/money";

// One InvoiceDoc drives the rendered SVG, the OCR text, the bounding boxes and the
// mock extraction, so the fixture can never disagree with the picture.

export type InvoiceLine = {
  partNumber: string | null;
  description: string;
  quantity: number;
  unit: string;
  unitPriceCents: number;
};

export type InvoiceDoc = {
  claimId: string;
  vendor: { name: string; taxId: string; street: string; cityState: string; bankName: string; accountLast4: string };
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  paymentTerms: string;
  poNumber: string | null;
  releaseNumber: string | null;
  grnNumber: string | null;
  gatePassNumber: string | null;
  projectCode: string | null;
  shipTo: { plant: string; address: string };
  lines: InvoiceLine[];
  taxRate: number;
  salesTaxCents: number;
  freightCents: number;
  otherChargesCents: number;
  otherChargesLabel: string;
  approval: { name: string; level: string } | null;
  attendees: { count: number; names: string[] } | null;
  notes: string[];
  /** Field-confidence overrides (e.g. a smudged total). */
  confidence: Partial<Record<string, number>>;
};

export const BILL_TO = {
  name: "Ironwood Safety Systems, Inc.",
  dept: "Accounts Payable — Attn: AP Shared Services",
  address: "2600 Featherstone Rd, Auburn Hills, MI 48326",
};

export const lineAmountCents = (l: InvoiceLine) => Math.round(l.quantity * l.unitPriceCents);
export const subtotalCents = (d: InvoiceDoc) => d.lines.reduce((s, l) => s + lineAmountCents(l), 0);
export const totalCents = (d: InvoiceDoc) => subtotalCents(d) + d.salesTaxCents + d.freightCents + d.otherChargesCents;

const W = 1200;
const H = 1600;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

const textWidth = (s: string, size: number, bold = false) => s.length * size * (bold ? 0.6 : 0.54);

function fmtQty(q: number): string {
  return Number.isInteger(q) ? q.toLocaleString("en-US") : q.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** Deterministic pseudo-confidence in [0.93, 0.995] from a string seed. */
function stableConfidence(seed: string): number {
  const h = createHash("sha256").update(seed).digest();
  return Math.round((0.93 + (h[0] / 255) * 0.065) * 1000) / 1000;
}

type Rendered = { svg: string; boxes: BoundingBox[]; ocrText: string };

export function renderInvoice(doc: InvoiceDoc): Rendered {
  const parts: string[] = [];
  const boxes: BoundingBox[] = [];
  const ocr: string[] = [];

  const box = (field: string, x: number, baselineY: number, text: string, size: number, bold = false) => {
    const w = textWidth(text, size, bold) + 12;
    const h = size + 12;
    boxes.push({
      field,
      x: round4((x - 6) / W),
      y: round4((baselineY - size - 4) / H),
      w: round4(w / W),
      h: round4(h / H),
      page: 1,
    });
  };
  const text = (x: number, y: number, s: string, size: number, opts: { bold?: boolean; anchor?: "start" | "end"; fill?: string; mono?: boolean } = {}) => {
    parts.push(
      `<text x="${x}" y="${y}" font-size="${size}" font-family="${opts.mono ? "Menlo, Consolas, monospace" : "Helvetica, Arial, sans-serif"}"${opts.bold ? ' font-weight="700"' : ""}${opts.anchor === "end" ? ' text-anchor="end"' : ""} fill="${opts.fill ?? "#1d2939"}">${esc(s)}</text>`,
    );
  };
  // Right-aligned value with its bounding box.
  const rightValue = (field: string | null, xEnd: number, y: number, s: string, size: number, bold = false) => {
    text(xEnd, y, s, size, { anchor: "end", bold, mono: true });
    if (field) box(field, xEnd - textWidth(s, size, bold), y, s, size, bold);
  };

  parts.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
  parts.push(`<rect width="${W}" height="36" fill="#fff4ed"/>`);
  text(72, 24, "SAMPLE — NOT A REAL INVOICE · synthetic document for the ClaimPilot PRO demo", 14, { fill: "#b54708" });

  // Letterhead
  parts.push(`<rect x="72" y="62" width="8" height="64" fill="#0a1b2e"/>`);
  text(96, 98, doc.vendor.name, 32, { bold: true, fill: "#0a1b2e" });
  box("vendorName", 96, 98, doc.vendor.name, 32, true);
  text(96, 124, `${doc.vendor.street}, ${doc.vendor.cityState}`, 15, { fill: "#475467" });
  text(96, 146, `EIN ${doc.vendor.taxId} · ACH remittance · W-9 on request`, 15, { fill: "#475467" });
  ocr.push(doc.vendor.name.toUpperCase(), `${doc.vendor.street}, ${doc.vendor.cityState}`, `EIN ${doc.vendor.taxId}`);

  text(1128, 100, "INVOICE", 44, { bold: true, anchor: "end", fill: "#0a1b2e" });
  ocr.push("INVOICE");

  // Meta block
  const meta: [string, string, string | null][] = [
    ["Invoice No.", doc.invoiceNumber, "invoiceNumber"],
    ["Invoice Date", doc.invoiceDate, "invoiceDate"],
    ["Due Date", doc.dueDate, null],
    ["Terms", doc.paymentTerms, null],
    ["PO Number", doc.poNumber ?? "—", doc.poNumber ? "poNumber" : null],
    ["Release", doc.releaseNumber ?? "—", null],
    ["GRN / Gate Pass", [doc.grnNumber, doc.gatePassNumber].filter(Boolean).join(" / ") || "—", doc.grnNumber ? "grnNumber" : null],
    ["Project Ref.", doc.projectCode ?? "—", doc.projectCode ? "projectCode" : null],
  ];
  parts.push(`<rect x="740" y="132" width="400" height="${meta.length * 30 + 20}" rx="6" fill="#f8fafc" stroke="#e4e7ec"/>`);
  meta.forEach(([label, value, field], i) => {
    const y = 160 + i * 30;
    text(758, y, label, 15, { fill: "#667085" });
    rightValue(field, 1124, y, value, 15, field === "invoiceNumber");
    ocr.push(`${label}: ${value}`);
  });

  // Bill-to / ship-to
  text(72, 214, "BILL TO", 13, { bold: true, fill: "#667085" });
  text(72, 238, BILL_TO.name, 17, { bold: true });
  text(72, 260, BILL_TO.dept, 15, { fill: "#475467" });
  text(72, 282, BILL_TO.address, 15, { fill: "#475467" });
  text(72, 330, "SHIP TO / SERVICE LOCATION", 13, { bold: true, fill: "#667085" });
  text(72, 354, doc.shipTo.plant, 17, { bold: true });
  text(72, 376, doc.shipTo.address, 15, { fill: "#475467" });
  ocr.push(`Bill To: ${BILL_TO.name}, ${BILL_TO.address}`, `Ship To: ${doc.shipTo.plant}, ${doc.shipTo.address}`);

  // Line items
  const tableTop = 430;
  parts.push(`<rect x="72" y="${tableTop}" width="1056" height="36" fill="#0a1b2e"/>`);
  const hdrY = tableTop + 24;
  const th = (x: number, s: string, anchor: "start" | "end" = "start") => text(x, hdrY, s, 13, { bold: true, fill: "#ffffff", anchor });
  th(84, "#");
  th(112, "PART NO.");
  th(282, "DESCRIPTION");
  th(812, "QTY", "end");
  th(826, "UNIT");
  th(1002, "UNIT PRICE", "end");
  th(1116, "AMOUNT", "end");
  ocr.push("Line | Part No. | Description | Qty | Unit | Unit Price | Amount");
  doc.lines.forEach((l, i) => {
    const y = tableTop + 36 + i * 40 + 26;
    if (i % 2 === 1) parts.push(`<rect x="72" y="${tableTop + 36 + i * 40}" width="1056" height="40" fill="#f8fafc"/>`);
    text(84, y, String(i + 1), 14, { fill: "#667085" });
    text(112, y, truncate(l.partNumber ?? "—", 18), 13, { mono: true });
    text(282, y, truncate(l.description, 52), 14);
    text(812, y, fmtQty(l.quantity), 14, { anchor: "end", mono: true });
    text(826, y, l.unit, 13, { fill: "#667085" });
    text(1002, y, formatUsd(l.unitPriceCents), 14, { anchor: "end", mono: true });
    text(1116, y, formatUsd(lineAmountCents(l)), 14, { anchor: "end", mono: true });
    ocr.push(`${i + 1} | ${l.partNumber ?? "-"} | ${l.description} | ${fmtQty(l.quantity)} | ${l.unit} | ${formatUsd(l.unitPriceCents)} | ${formatUsd(lineAmountCents(l))}`);
  });
  const tableBottom = tableTop + 36 + doc.lines.length * 40;
  parts.push(`<line x1="72" y1="${tableBottom}" x2="1128" y2="${tableBottom}" stroke="#d0d5dd"/>`);

  // Totals
  let ty = tableBottom + 44;
  const totalRow = (label: string, valueCents: number, field: string | null, bold = false, size = 16) => {
    text(800, ty, label, size, { fill: bold ? "#0a1b2e" : "#475467", bold });
    rightValue(field, 1116, ty, formatUsd(valueCents), size, bold);
    ocr.push(`${label}: ${formatUsd(valueCents)}`);
    ty += size + 18;
  };
  totalRow("Subtotal", subtotalCents(doc), "subtotal");
  totalRow(doc.taxRate > 0 ? `Sales Tax (${(doc.taxRate * 100).toFixed(2)}%)` : "Sales Tax (exempt)", doc.salesTaxCents, "salesTax");
  totalRow("Freight", doc.freightCents, null);
  if (doc.otherChargesCents) totalRow(doc.otherChargesLabel, doc.otherChargesCents, null);
  parts.push(`<rect x="786" y="${ty - 10}" width="342" height="52" rx="6" fill="#fff4ed" stroke="#f97316"/>`);
  ty += 24;
  totalRow("TOTAL DUE (USD)", totalCents(doc), "total", true, 22);

  // Notes / attendees (left of totals)
  let ny = tableBottom + 44;
  const note = (s: string) => {
    text(72, ny, truncate(s, 80), 14, { fill: "#475467" });
    ocr.push(s);
    ny += 24;
  };
  if (doc.attendees) {
    note(`Guests: ${doc.attendees.count}`);
    note(doc.attendees.names.length ? `Attendees: ${doc.attendees.names.join(", ")}` : "Attendee list: not provided");
  }
  doc.notes.forEach(note);

  // Remit-to + approval
  text(72, 1356, "REMIT TO", 13, { bold: true, fill: "#667085" });
  text(72, 1380, `${doc.vendor.name} · ${doc.vendor.bankName} · ACH account ••••${doc.vendor.accountLast4}`, 15);
  ocr.push(`Remit To: ${doc.vendor.name}, ${doc.vendor.bankName}, ACH account ending ${doc.vendor.accountLast4}`);
  text(72, 1432, "CUSTOMER APPROVAL", 13, { bold: true, fill: "#667085" });
  if (doc.approval) {
    text(72, 1462, `${doc.approval.name}`, 22, { fill: "#175cd3" });
    box("approval", 72, 1462, doc.approval.name, 22);
    text(72, 1486, `${doc.approval.level} · Ironwood Safety Systems`, 14, { fill: "#475467" });
    ocr.push(`Approved by: ${doc.approval.name}, ${doc.approval.level}`);
  } else {
    text(72, 1462, "— not signed —", 18, { fill: "#98a2b3" });
    ocr.push("Approved by: (none)");
  }
  parts.push(`<line x1="72" y1="1470" x2="420" y2="1470" stroke="#98a2b3"/>`);
  text(72, 1560, `Payment terms ${doc.paymentTerms}. All amounts in US dollars. Fictional vendor and tax ID — demo data only.`, 13, { fill: "#98a2b3" });

  // Watermark last so it sits on top, but faint enough not to obscure fields.
  parts.push(
    `<text x="600" y="900" font-size="78" font-family="Helvetica, Arial, sans-serif" font-weight="700" fill="#b42318" fill-opacity="0.07" text-anchor="middle" transform="rotate(-28 600 900)">SAMPLE — NOT A REAL INVOICE</text>`,
  );

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Sample invoice ${esc(doc.invoiceNumber)} from ${esc(doc.vendor.name)}">${parts.join("")}</svg>`;
  return { svg, boxes, ocrText: ocr.join("\n") };
}

function round4(n: number) {
  return Math.max(0, Math.min(1, Math.round(n * 10000) / 10000));
}

/** Build the extraction a perfect OCR+LLM pass would produce from this document. */
export function buildExtraction(doc: InvoiceDoc, boxes: BoundingBox[]): Extraction {
  const conf = (field: string) => doc.confidence[field] ?? stableConfidence(`${doc.claimId}:${field}`);
  const fieldConfidence: Record<string, number> = {};
  for (const f of ["vendorName", "invoiceNumber", "invoiceDate", "poNumber", "grnNumber", "projectCode", "subtotal", "salesTax", "total"]) {
    fieldConfidence[f] = conf(f);
  }
  return normalizeExtraction({
    vendor: { name: doc.vendor.name, taxId: doc.vendor.taxId, address: doc.vendor.cityState, confidence: fieldConfidence.vendorName },
    invoiceNumber: doc.invoiceNumber,
    invoiceDate: doc.invoiceDate,
    dueDate: doc.dueDate,
    currency: "USD",
    poNumber: doc.poNumber,
    releaseNumber: doc.releaseNumber,
    grnNumber: doc.grnNumber,
    gatePassNumber: doc.gatePassNumber,
    projectCode: doc.projectCode,
    shipTo: { plant: doc.shipTo.plant, address: doc.shipTo.address },
    billTo: BILL_TO.name,
    paymentTerms: doc.paymentTerms,
    remitTo: { bankName: doc.vendor.bankName, accountLast4: doc.vendor.accountLast4 },
    attendees: doc.attendees,
    lineItems: doc.lines.map((l, i) => ({
      line: i + 1,
      partNumber: l.partNumber,
      description: l.description,
      quantity: l.quantity,
      unit: l.unit,
      unitPrice: centsToNumber(l.unitPriceCents),
      amount: centsToNumber(lineAmountCents(l)),
      confidence: stableConfidence(`${doc.claimId}:line${i}`),
    })),
    subtotal: centsToNumber(subtotalCents(doc)),
    salesTax: centsToNumber(doc.salesTaxCents),
    freight: centsToNumber(doc.freightCents),
    otherCharges: centsToNumber(doc.otherChargesCents),
    total: centsToNumber(totalCents(doc)),
    taxRate: doc.taxRate,
    approval: doc.approval,
    fieldConfidence,
    boundingBoxes: boxes.filter((b) => b.field !== "approval"),
    warnings: [],
  });
}

export function buildFixture(doc: InvoiceDoc): { svg: string; fixture: ReceiptFixture; hash: string } {
  const { svg, boxes, ocrText } = renderInvoice(doc);
  const extraction = buildExtraction(doc, boxes);
  const fixture: ReceiptFixture = { claimId: doc.claimId, ocrText, ocrConfidence: 0.96, extraction, boxes };
  return { svg, fixture, hash: sha256(svg) };
}

export function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}
