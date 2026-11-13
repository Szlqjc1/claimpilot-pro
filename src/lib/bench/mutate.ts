import type { Extraction } from "@/lib/domain/schemas";
import { CRITICAL_GROUNDED_FIELDS, checkField, datesInText, moneyInText } from "@/lib/ai/grounding";

// Mutated corpus for docs/GROUNDING_BENCH.md (population B). Pure and deterministic: no randomness is needed,
// each (claim, field, kind) has exactly one construction. Returns null when a kind cannot be built honestly for
// that document (e.g. no second id in the text to confuse with).
//
//   absent      — a wrong value that does not appear in the OCR text (the easy case for grounding)
//   confusable  — a wrong value that DOES appear in the OCR text, taken from another field (the hard case)
//   format      — the same, correct value written differently (benign: must NOT be flagged)

export type CriticalField = (typeof CRITICAL_GROUNDED_FIELDS)[number];
export type MutationKind = "absent" | "confusable" | "format";
export type Mutation = { field: CriticalField; kind: MutationKind; description: string; extraction: Extraction; ocrText: string; isError: boolean };

const valueOf = (e: Extraction, f: CriticalField): string | number | null =>
  (f === "vendorName" ? e.vendor.name : (e[f] as string | number | null)) ?? null;
const withValue = (e: Extraction, f: CriticalField, v: string | number | null): Extraction =>
  f === "vendorName" ? { ...e, vendor: { ...e.vendor, name: v as string | null } } : ({ ...e, [f]: v } as Extraction);

const bumpLastDigit = (s: string) => {
  const i = s.search(/\d(?!.*\d)/);
  return i < 0 ? `${s}1` : `${s.slice(0, i)}${(Number(s[i]) + 3) % 10}${s.slice(i + 1)}`;
};
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const usOf = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;
const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** A wrong value guaranteed absent from the OCR text (checked with the same normalisation grounding uses). */
function absent(e: Extraction, text: string, f: CriticalField): Mutation | null {
  const v = valueOf(e, f);
  let candidate: string | number | null = null;
  let description = "";
  if (f === "vendorName") {
    const name = String(v ?? "Acme Industrial Supply");
    candidate = name.replace(/[aeiou](?=[^aeiou]*$)/i, (m) => (m.toLowerCase() === "o" ? "a" : "o"));
    description = v === null ? "vendor hallucinated" : "one letter of the vendor name changed";
  } else if (f === "invoiceNumber" || f === "poNumber") {
    candidate = v === null ? "4500999" : bumpLastDigit(String(v));
    description = v === null ? `${f} hallucinated` : `last digit of ${f} changed`;
  } else if (f === "invoiceDate") {
    const dates = datesInText(text);
    for (let n = 1; n < 40 && candidate === null; n++) if (!dates.has(addDays(String(v), n))) candidate = addDays(String(v), n);
    description = "invoice date shifted to a date not on the document";
  } else {
    const cents = moneyInText(text);
    let t = Math.round(Number(v) * 110) / 100;
    while (cents.has(Math.round(t * 100))) t = Math.round((t + 1.37) * 100) / 100;
    candidate = t;
    description = "total inflated ~10 % to an amount not on the document";
  }
  if (candidate === null || candidate === v) return null;
  const extraction = withValue(e, f, candidate);
  if (checkField(f, extraction, text) !== "not_found") return null; // must really be absent
  return { field: f, kind: "absent", description, extraction, ocrText: text, isError: true };
}

/** A wrong value that is present in the OCR text because it belongs to another field. */
function confusable(e: Extraction, text: string, f: CriticalField): Mutation | null {
  const v = valueOf(e, f);
  const options: [string | number | null | undefined, string][] = [];
  if (f === "vendorName") options.push([text.match(/Shanghai Joyson Safety Systems Co\., Ltd\./)?.[0], "bill-to company read as the vendor"]);
  if (f === "invoiceNumber") options.push([e.poNumber, "PO number read as the invoice number"], [e.vendor.taxId, "vendor tax id read as the invoice number"]);
  if (f === "poNumber") options.push([e.grnNumber, "GRN read as the PO number"], [e.invoiceNumber, "invoice number read as the PO number"]);
  if (f === "invoiceDate") options.push([e.dueDate, "due date read as the invoice date"]);
  if (f === "total") {
    options.push([e.subtotal, "subtotal read as the total"]);
    const lines = [...e.lineItems].sort((a, b) => b.amount - a.amount);
    if (lines[0]) options.push([lines[0].amount, "largest line amount read as the total"]);
  }
  for (const [candidate, description] of options) {
    if (candidate === null || candidate === undefined || candidate === v) continue;
    if (typeof candidate === "number" && typeof v === "number" && Math.round(candidate * 100) === Math.round(v * 100)) continue;
    const extraction = withValue(e, f, candidate);
    if (checkField(f, extraction, text) === "found") return { field: f, kind: "confusable", description, extraction, ocrText: text, isError: true };
  }
  return null;
}

/** The same correct value, spelled differently in the extraction or on the document. */
function format(e: Extraction, text: string, f: CriticalField): Mutation | null {
  const v = valueOf(e, f);
  if (v === null) return null;
  const ok = (extraction: Extraction, ocrText: string, description: string): Mutation => ({ field: f, kind: "format", description, extraction, ocrText, isError: false });
  switch (f) {
    case "vendorName":
      return ok(withValue(e, f, `${String(v).toUpperCase()}, INC.`), text, "vendor upper-cased with a legal suffix");
    case "invoiceNumber":
      return ok(withValue(e, f, String(v).toLowerCase().replace(/-/g, " ")), text, "invoice number lower-cased, dashes as spaces");
    case "poNumber":
      return String(v).length > 3 ? ok(withValue(e, f, `${String(v).slice(0, 4)}-${String(v).slice(4)}`), text, "PO number with an inserted dash") : null;
    case "invoiceDate":
      return text.includes(String(v)) ? ok(e, text.replace(String(v), usOf(String(v))), "document prints the date as MM/DD/YYYY") : null;
    case "total": {
      const printed = money(Number(v));
      return text.includes(printed) ? ok(e, text.split(printed).join(`${Number(v).toFixed(2)} USD`), "document prints the total without $ and thousands separators") : null;
    }
  }
}

export function mutationsFor(extraction: Extraction, ocrText: string): Mutation[] {
  const out: Mutation[] = [];
  for (const f of CRITICAL_GROUNDED_FIELDS) {
    for (const m of [absent(extraction, ocrText, f), confusable(extraction, ocrText, f), format(extraction, ocrText, f)]) if (m) out.push(m);
  }
  return out;
}
