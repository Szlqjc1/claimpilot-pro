// Field labels (Task 13 A1, D-44). Does the OCR text carry a label for a field, whatever its value? Pure.
// Used by presence classification: a label with no value means "there is a value and we failed to read it",
// no label means "this document has no such field".

export type CriticalField = "vendorName" | "invoiceNumber" | "invoiceDate" | "poNumber" | "total";
export const CRITICAL_FIELDS: readonly CriticalField[] = ["vendorName", "invoiceNumber", "invoiceDate", "poNumber", "total"];

export const FIELD_LABEL_ALIASES: Record<CriticalField, string[]> = {
  invoiceNumber: ["invoice no", "invoice #", "invoice number", "inv. #", "inv #", "bill no", "document no", "发票号", "单据号"],
  invoiceDate: ["invoice date", "issue date", "issued", "date", "开票日期", "日期"],
  poNumber: ["po number", "po no", "p.o.", "purchase order", "order no", "采购订单", "订单号"],
  total: ["total due", "grand total", "amount due", "balance due", "total", "合计", "总计", "应付"],
  vendorName: ["vendor", "supplier", "remit to", "from", "供应商", "销售方"],
};

const DASHES = /[‐-―−-]/g;
const escape = (c: string) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const isWordChar = (c: string) => /[a-z0-9]/i.test(c);
const hasCjk = (s: string) => /[㐀-鿿]/.test(s);

/** Lower case; every dash variant becomes a space; runs of spaces/tabs become one space. Line breaks are kept. */
function normalise(text: string): string {
  return text.toLowerCase().replace(DASHES, " ").replace(/[^\S\n]+/g, " ");
}

/**
 * One alias → one pattern source. Latin aliases match on word boundaries (only where the alias itself starts or ends
 * with a letter or digit, so "inv. #" and "p.o." still match right before a value), with any whitespace, or none,
 * between tokens. CJK has no word boundaries: a plain whitespace-insensitive substring match.
 */
function aliasSource(alias: string): string {
  const a = normalise(alias).trim();
  if (hasCjk(a)) return a.split("").filter((c) => c !== " ").map(escape).join("\\s*");
  const body = a
    .split("")
    .map((c) => (c === " " ? "\\s*" : escape(c)))
    .join("");
  const start = isWordChar(a[0]) ? "(?<![a-z0-9])" : "";
  const end = isWordChar(a[a.length - 1]) ? "(?![a-z0-9])" : "";
  return `${start}${body}${end}`;
}

const SOURCES: Record<CriticalField, string[]> = Object.fromEntries(
  Object.entries(FIELD_LABEL_ALIASES).map(([f, aliases]) => [f, aliases.map(aliasSource)]),
) as Record<CriticalField, string[]>;

/** True if any alias of the field's label occurs in the OCR text. */
export function labelPresent(field: CriticalField, text: string): boolean {
  const t = normalise(text);
  return SOURCES[field].some((s) => new RegExp(s).test(t));
}

// What may follow a label to say "there is none": a dash, N/A, n.a., none, not applicable or 无, then the end of the
// line or the next table cell. A BLANK after the label is not a statement: OCR may simply have dropped the value,
// so that stays "unreadable".
const EMPTY_AFTER_LABEL = /^[ \t]*[:#.|]*[ \t]*(?:n\/?a|n\.a\.|none|not applicable|无)[ \t]*(?:\n|\||$)/;
/** A run of dashes standing alone before the end of a line or cell ("PO Number: —") → "n/a", before normalise. */
const DASH_ONLY_VALUE = /(^|[\s:|#])[‐-―−-]+(?=[ \t]*(?:\r?\n|\||$))/gm;

/**
 * True if the document states the field is empty: its label occurs, and every occurrence is followed only by an
 * empty marker ("PO Number: —", "PO No.: N/A"). Such a field is absent, not unreadable: the document says it has none.
 */
export function labelExplicitlyEmpty(field: CriticalField, text: string): boolean {
  const t = normalise(text.replace(DASH_ONLY_VALUE, "$1n/a"));
  let seen = false;
  for (const s of SOURCES[field]) {
    for (const m of t.matchAll(new RegExp(s, "g"))) {
      seen = true;
      if (!EMPTY_AFTER_LABEL.test(t.slice((m.index ?? 0) + m[0].length))) return false;
    }
  }
  return seen;
}
