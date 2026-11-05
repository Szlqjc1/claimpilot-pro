import type { Extraction } from "@/lib/domain/schemas";
import { normalizeVendorName } from "@/lib/risk/rules";

// OCR grounding (DECISIONS D-37): is each extracted value literally present in the OCR text?
// Pure and deterministic. It detects values the extractor invented or altered; it CANNOT detect an OCR-level
// misread (if OCR reads 5 as 6 and the extractor copies it, the value is grounded and wrong). That class is
// covered by R-10 / R-07 / R-08 and human review (docs/RISK_RULES.md).

export type FieldCheck = "found" | "not_found" | "not_extracted";
export const GROUNDED_FIELDS = ["vendorName", "invoiceNumber", "invoiceDate", "poNumber", "grnNumber", "projectCode", "subtotal", "salesTax", "total"] as const;
export type GroundedField = (typeof GROUNDED_FIELDS)[number];
/** The fields R-14 checks. Must match CRITICAL_FIELDS in src/lib/risk/rules.ts. */
export const CRITICAL_GROUNDED_FIELDS = ["vendorName", "invoiceNumber", "invoiceDate", "poNumber", "total"] as const satisfies readonly GroundedField[];

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const pad = (n: number) => String(n).padStart(2, "0");
const escape = (c: string) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every amount in the text, in cents: "$56,800.00", "56,800", "56800.00", "$0.00". */
export function moneyInText(text: string): Set<number> {
  const out = new Set<number>();
  for (const m of text.matchAll(/(?<![\d.,])\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?(?![\d,])|(?<![\d.,])\d+(?:\.\d{1,2})?(?![\d,])/g)) {
    const v = Number(m[0].replace(/,/g, ""));
    if (Number.isFinite(v)) out.add(Math.round(v * 100));
  }
  return out;
}

/** Every date in the text as ISO: 2026-10-21, 10/21/2026, Oct 21, 2026, October 21 2026. */
export function datesInText(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g)) out.add(`${m[1]}-${pad(+m[2])}-${pad(+m[3])}`);
  for (const m of text.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g)) out.add(`${m[3]}-${pad(+m[1])}-${pad(+m[2])}`);
  for (const m of text.matchAll(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\b/g)) {
    const mi = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    if (mi >= 0) out.add(`${m[3]}-${pad(mi + 1)}-${pad(+m[2])}`);
  }
  return out;
}

/** An identifier, case-insensitive, at alphanumeric boundaries, tolerating space / - / . / slash between characters. */
export function identifierInText(value: string, text: string): boolean {
  const chars = value.replace(/[\s\-/.]/g, "").split("");
  if (chars.length === 0) return false;
  const pattern = new RegExp(`(?<![A-Za-z0-9])${chars.map(escape).join("[\\s\\-/.]?")}(?![A-Za-z0-9])`, "i");
  return pattern.test(text);
}

function vendorInText(value: string, text: string): boolean {
  const v = normalizeVendorName(value);
  return v.length > 0 && ` ${normalizeVendorName(text)} `.includes(` ${v} `);
}

const isBlank = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");

export function checkField(field: GroundedField, extraction: Extraction, ocrText: string): FieldCheck {
  const value =
    field === "vendorName" ? extraction.vendor?.name : (extraction as unknown as Record<string, unknown>)[field];
  if (isBlank(value)) return "not_extracted";
  switch (field) {
    case "vendorName":
      return vendorInText(String(value), ocrText) ? "found" : "not_found";
    case "invoiceDate":
      return datesInText(ocrText).has(String(value)) ? "found" : "not_found";
    case "subtotal":
    case "salesTax":
    case "total":
      return typeof value === "number" && moneyInText(ocrText).has(Math.round(value * 100)) ? "found" : "not_found";
    default:
      return identifierInText(String(value), ocrText) ? "found" : "not_found";
  }
}

/** Field-level grounding of an extraction against the OCR text it was produced from. */
export function groundExtraction(extraction: Extraction, ocrText: string): Record<GroundedField, FieldCheck> {
  return Object.fromEntries(GROUNDED_FIELDS.map((f) => [f, checkField(f, extraction, ocrText)])) as Record<GroundedField, FieldCheck>;
}
