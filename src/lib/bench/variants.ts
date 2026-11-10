// Label/layout variant benchmark (Task 13 Part B, D-45): pure parts — label sets, layouts, the HTML renderer and
// the three metrics. The runner (scripts/extraction-variants.ts) adds Chromium, Tesseract and the live model.
import { formatUsd } from "@/lib/domain/money";
import { BILL_TO, lineAmountCents, subtotalCents, totalCents, type InvoiceDoc } from "@/lib/receipts/invoice";
import { normalizeInvoiceNumber, normalizeVendorName } from "@/lib/risk/rules";
import type { CriticalField } from "@/lib/ai/labels";
import type { Extraction } from "@/lib/domain/schemas";

export type LabelVariant = "canonical" | "abbreviated" | "verbose" | "german" | "chinese";
export type LayoutVariant = "label-left" | "label-above" | "dense-two-column";
export const LABEL_VARIANTS: LabelVariant[] = ["canonical", "abbreviated", "verbose", "german", "chinese"];
export const LAYOUT_VARIANTS: LayoutVariant[] = ["label-left", "label-above", "dense-two-column"];

type Labels = {
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  terms: string;
  poNumber: string;
  release: string;
  grn: string;
  project: string;
  billTo: string;
  shipTo: string;
  cols: [string, string, string, string, string, string];
  subtotal: string;
  tax: string;
  freight: string;
  other: string;
  total: string;
  remitTo: string;
  approvedBy: string;
  notSigned: string;
};

/** One rendering per label style. Only the labels change; every value is identical across the five. */
export const LABEL_SETS: Record<LabelVariant, Labels> = {
  canonical: {
    invoiceNumber: "Invoice No.",
    invoiceDate: "Invoice Date",
    dueDate: "Due Date",
    terms: "Terms",
    poNumber: "PO Number",
    release: "Release",
    grn: "GRN / Gate Pass",
    project: "Project Ref.",
    billTo: "Bill To",
    shipTo: "Ship To",
    cols: ["Part No.", "Description", "Qty", "Unit", "Unit Price", "Amount"],
    subtotal: "Subtotal",
    tax: "Sales Tax",
    freight: "Freight",
    other: "Other charges",
    total: "TOTAL DUE (USD)",
    remitTo: "Remit To",
    approvedBy: "Approved by",
    notSigned: "(none)",
  },
  abbreviated: {
    invoiceNumber: "Inv. #",
    invoiceDate: "Inv. Date",
    dueDate: "Due",
    terms: "Terms",
    poNumber: "PO #",
    release: "Rel.",
    grn: "GRN",
    project: "Proj.",
    billTo: "Bill To",
    shipTo: "Ship To",
    cols: ["Part", "Desc.", "Qty", "U/M", "Price", "Ext."],
    subtotal: "Subtot.",
    tax: "Tax",
    freight: "Frt.",
    other: "Other",
    total: "Total",
    remitTo: "Remit",
    approvedBy: "Appr.",
    notSigned: "(none)",
  },
  verbose: {
    invoiceNumber: "Invoice Number",
    invoiceDate: "Invoice Issue Date",
    dueDate: "Payment Due Date",
    terms: "Payment Terms",
    poNumber: "Purchase Order Number",
    release: "Blanket Release Number",
    grn: "Goods Receipt / Gate Pass Number",
    project: "Customer Project Reference",
    billTo: "Invoice Addressed To",
    shipTo: "Goods Delivered To",
    cols: ["Part Number", "Item Description", "Quantity", "Unit of Measure", "Unit Price", "Line Amount"],
    subtotal: "Subtotal Before Tax",
    tax: "Sales Tax Charged",
    freight: "Freight Charges",
    other: "Other Charges",
    total: "Total Amount Due (USD)",
    remitTo: "Please Remit Payment To",
    approvedBy: "Customer Approval Given By",
    notSigned: "(none)",
  },
  german: {
    invoiceNumber: "Rechnungsnummer",
    invoiceDate: "Rechnungsdatum",
    dueDate: "Fälligkeitsdatum",
    terms: "Zahlungsbedingungen",
    poNumber: "Bestellnummer",
    release: "Abruf",
    grn: "Wareneingang / Torschein",
    project: "Projektreferenz",
    billTo: "Rechnungsempfänger",
    shipTo: "Lieferanschrift",
    cols: ["Teilenr.", "Beschreibung", "Menge", "Einheit", "Einzelpreis", "Betrag"],
    subtotal: "Zwischensumme",
    tax: "Umsatzsteuer",
    freight: "Fracht",
    other: "Sonstige Kosten",
    total: "Gesamtbetrag (USD)",
    remitTo: "Zahlung an",
    approvedBy: "Genehmigt von",
    notSigned: "(keine)",
  },
  chinese: {
    invoiceNumber: "发票号",
    invoiceDate: "开票日期",
    dueDate: "到期日",
    terms: "付款条件",
    poNumber: "采购订单",
    release: "下达号",
    grn: "收货单 / 门禁单",
    project: "项目编号",
    billTo: "购买方",
    shipTo: "收货地址",
    cols: ["零件号", "描述", "数量", "单位", "单价", "金额"],
    subtotal: "小计",
    tax: "销售税",
    freight: "运费",
    other: "其他费用",
    total: "合计 (USD)",
    remitTo: "收款账户",
    approvedBy: "审批人",
    notSigned: "(无)",
  },
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The header fields, in order: [label, value]. A field the invoice does not carry shows "—", as the seed does. */
function headerFields(doc: InvoiceDoc, l: Labels): [string, string][] {
  return [
    [l.invoiceNumber, doc.invoiceNumber],
    [l.invoiceDate, doc.invoiceDate],
    [l.dueDate, doc.dueDate],
    [l.terms, doc.paymentTerms],
    [l.poNumber, doc.poNumber ?? "—"],
    [l.release, doc.releaseNumber ?? "—"],
    [l.grn, [doc.grnNumber, doc.gatePassNumber].filter(Boolean).join(" / ") || "—"],
    [l.project, doc.projectCode ?? "—"],
  ];
}

function headerHtml(fields: [string, string][], layout: LayoutVariant): string {
  const cell = (s: string, cls: string) => `<td class="${cls}">${esc(s)}</td>`;
  if (layout === "label-left") {
    return `<table class="hdr left">${fields.map(([k, v]) => `<tr>${cell(k, "k")}${cell(v, "v right")}</tr>`).join("")}</table>`;
  }
  if (layout === "label-above") {
    return `<div class="hdr above">${fields.map(([k, v]) => `<div class="blk"><div class="k small">${esc(k)}</div><div class="v">${esc(v)}</div></div>`).join("")}</div>`;
  }
  const rows: string[] = [];
  for (let i = 0; i < fields.length; i += 2) {
    const pair = fields.slice(i, i + 2);
    rows.push(`<tr>${pair.map(([k, v]) => `${cell(`${k}:`, "k tight")}${cell(v, "v tight")}`).join("")}</tr>`);
  }
  return `<table class="hdr dense">${rows.join("")}</table>`;
}

/** A complete one-page invoice as HTML, ~850 px wide (one letter page at 100 px/in). */
export type FontVariant = "default" | "serif" | "condensed" | "small-print";
export const FONT_VARIANTS: FontVariant[] = ["default", "serif", "condensed", "small-print"];

/**
 * Type only (Task 14 B1, D-48); appended after the base stylesheet so "default" renders byte-identically to before.
 * serif / condensed change every face, amounts included, at the same sizes; small print sets the body text (address
 * lines, parties, footer notes) to 8 pt instead of ~10–11 pt and leaves the tables (header, items, totals) unchanged.
 */
export const FONT_CSS: Record<FontVariant, string> = {
  default: "",
  serif: '*{font-family:"Times New Roman",Georgia,serif !important}',
  condensed: '*{font-family:"Arial Narrow","Roboto Condensed",sans-serif !important}',
  "small-print": ".sub,.parties,.foot,.parties b{font-size:8pt !important}",
};

export function variantHtml(doc: InvoiceDoc, label: LabelVariant, layout: LayoutVariant, font: FontVariant = "default"): string {
  const l = LABEL_SETS[label];
  const money = (c: number) => esc(formatUsd(c));
  const lines = doc.lines
    .map(
      (li) =>
        `<tr><td class="mono">${esc(li.partNumber ?? "—")}</td><td>${esc(li.description)}</td><td class="right">${li.quantity}</td><td>${esc(li.unit)}</td><td class="right mono">${money(li.unitPriceCents)}</td><td class="right mono">${money(lineAmountCents(li))}</td></tr>`,
    )
    .join("");
  const totals: [string, number, boolean][] = [
    [l.subtotal, subtotalCents(doc), false],
    [l.tax, doc.salesTaxCents, false],
    [l.freight, doc.freightCents, false],
    ...(doc.otherChargesCents ? ([[l.other, doc.otherChargesCents, false]] as [string, number, boolean][]) : []),
    [l.total, totalCents(doc), true],
  ];
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#fff;font:15px "Segoe UI","Microsoft YaHei",Arial,sans-serif;color:#111}
.page{width:850px;padding:40px 48px;box-sizing:border-box}
h1{font-size:26px;margin:0}.sub{color:#333;font-size:13px;margin:2px 0}
.top{display:flex;justify-content:space-between;align-items:flex-start;gap:24px}
.title{font-size:30px;font-weight:700;letter-spacing:2px}
table{border-collapse:collapse}.right{text-align:right}.mono{font-family:Consolas,monospace}
.hdr.left{min-width:330px}.hdr.left td{padding:2px 6px}.hdr .k{color:#333}
.hdr.above{display:grid;grid-template-columns:repeat(4,1fr);gap:10px 18px;margin-top:22px}
.hdr.above .small{font-size:12px}.hdr.above .v{font-weight:600}
.hdr.dense{margin-top:18px;font-size:13px}.hdr.dense td{padding:1px 4px}.hdr.dense .v{padding-right:18px}
.parties{display:flex;gap:40px;margin-top:22px;font-size:13px}.parties b{display:block;font-size:12px;color:#333}
.items{width:100%;margin-top:22px;font-size:13px}.items th{background:#eee;text-align:left;padding:5px}.items td{padding:4px 5px;border-bottom:1px solid #ddd}
.totals{margin-left:auto;margin-top:14px;font-size:14px}.totals td{padding:2px 8px}.totals .grand td{font-weight:700;border-top:2px solid #111}
.foot{margin-top:24px;font-size:13px}
${FONT_CSS[font]}</style></head><body><div class="page">
<div class="top"><div><h1>${esc(doc.vendor.name)}</h1><p class="sub">${esc(`${doc.vendor.street}, ${doc.vendor.cityState}`)}</p><p class="sub">EIN ${esc(doc.vendor.taxId)}</p></div>
<div><div class="title right">INVOICE</div>${layout === "label-left" ? headerHtml(headerFields(doc, l), layout) : ""}</div></div>
${layout === "label-left" ? "" : headerHtml(headerFields(doc, l), layout)}
<div class="parties"><div><b>${esc(l.billTo)}</b>${esc(BILL_TO.name)}<br>${esc(BILL_TO.address)}</div><div><b>${esc(l.shipTo)}</b>${esc(doc.shipTo.plant)}<br>${esc(doc.shipTo.address)}</div></div>
<table class="items"><thead><tr>${l.cols.map((c, i) => `<th class="${i >= 4 || i === 2 ? "right" : ""}">${esc(c)}</th>`).join("")}</tr></thead><tbody>${lines}</tbody></table>
<table class="totals">${totals.map(([k, c, grand]) => `<tr class="${grand ? "grand" : ""}"><td>${esc(k)}</td><td class="right mono">${money(c)}</td></tr>`).join("")}</table>
<div class="foot">${doc.notes.map((n) => `<p>${esc(n)}</p>`).join("")}
<p>${esc(l.remitTo)}: ${esc(`${doc.vendor.name}, ${doc.vendor.bankName}, ACH ••••${doc.vendor.accountLast4}`)}</p>
<p>${esc(l.approvedBy)}: ${doc.approval ? esc(`${doc.approval.name}, ${doc.approval.level}`) : esc(l.notSigned)}</p></div>
</div></body></html>`;
}

// ── metrics ──────────────────────────────────────────────────────────────────────────────────────────────────

export const BENCH_FIELDS: CriticalField[] = ["vendorName", "invoiceNumber", "invoiceDate", "poNumber", "total"];

export type FieldOutcome = "correct" | "wrong" | "missed" | "correct-null";

/** Compare one extracted critical field with the reference extraction. */
export function fieldOutcome(field: CriticalField, got: Extraction, truth: Extraction): FieldOutcome {
  const g = field === "vendorName" ? got.vendor.name : got[field];
  const t = field === "vendorName" ? truth.vendor.name : truth[field];
  if (g === null || g === undefined || g === "") return t === null || t === undefined ? "correct-null" : "missed";
  if (t === null || t === undefined) return "wrong";
  switch (field) {
    case "vendorName":
      return normalizeVendorName(String(g)) === normalizeVendorName(String(t)) ? "correct" : "wrong";
    case "invoiceNumber":
    case "poNumber":
      return normalizeInvoiceNumber(String(g)) === normalizeInvoiceNumber(String(t)) ? "correct" : "wrong";
    case "total":
      return Math.round(Number(g) * 100) === Math.round(Number(t) * 100) ? "correct" : "wrong";
    default:
      return String(g) === String(t) ? "correct" : "wrong";
  }
}

export type DocResult = {
  axis: string; // "label" | "layout" | "perspective" | "font" | "quality"
  variant: string;
  claimId: string;
  outcomes: Record<CriticalField, FieldOutcome>;
  escalated: boolean; // R-14, R-19 or R-20 fired (the extraction-quality rules)
  cleared: boolean; // decision AUTO_APPROVE
};

export type VariantSummary = {
  axis: string;
  variant: string;
  docs: number;
  returned: number;
  correct: number;
  accuracy: number;
  escalated: number;
  escalationRate: number;
  cleared: number;
  clearedWithError: number;
  errorInCleared: number;
  /** Documents with any outcome other than a correct auto-clear (D-47 decision metric, "error_or_escalation"). */
  bad: number;
};

/** A document is wrong if any critical field is wrong or missed. */
export const docHasError = (r: DocResult) => Object.values(r.outcomes).some((o) => o === "wrong" || o === "missed");

/** The three columns, never one: field accuracy, escalation rate, error rate among auto-cleared claims. */
export function summarise(rows: DocResult[], axis: string, variant: string): VariantSummary {
  const rs = rows.filter((r) => r.axis === axis && r.variant === variant);
  const all = rs.flatMap((r) => Object.values(r.outcomes));
  const returned = all.filter((o) => o === "correct" || o === "wrong").length;
  const correct = all.filter((o) => o === "correct").length;
  const escalated = rs.filter((r) => r.escalated).length;
  const cleared = rs.filter((r) => r.cleared);
  const clearedWithError = cleared.filter(docHasError).length;
  return {
    axis,
    variant,
    docs: rs.length,
    returned,
    correct,
    accuracy: returned ? correct / returned : 0,
    escalated,
    escalationRate: rs.length ? escalated / rs.length : 0,
    cleared: cleared.length,
    clearedWithError,
    errorInCleared: cleared.length ? clearedWithError / cleared.length : 0,
    bad: rs.filter((r) => !(r.cleared && !docHasError(r))).length,
  };
}

export type RecoveryDecision = { gap: number; recovered: number; recoveryPct: number | null; verdict: "build" | "do-not-build" | "spike" | "no-measurable-gap" };

/**
 * The pre-registered rule (docs/PERSPECTIVE.md, written before the run): gap = bad(A1) − bad(A0),
 * recovered = bad(A1) − bad(A2), recovery% = recovered / gap. ≥ 70 % build; ≤ 30 % (or negative) do not build;
 * between: spike. A gap of at most one document (≤ 5 % of 20) is "no measurable gap": do not build.
 */
export function recoveryDecision(bad: { a0: number; a1: number; a2: number }, docs: number): RecoveryDecision {
  const gap = bad.a1 - bad.a0;
  const recovered = bad.a1 - bad.a2;
  if (gap <= Math.max(1, Math.floor(docs * 0.05))) return { gap, recovered, recoveryPct: null, verdict: "no-measurable-gap" };
  const recoveryPct = recovered / gap;
  return { gap, recovered, recoveryPct, verdict: recoveryPct >= 0.7 ? "build" : recoveryPct <= 0.3 ? "do-not-build" : "spike" };
}
