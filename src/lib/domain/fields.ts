import type { Extraction } from "./schemas";

// Shared between the AI Structured Data card and the annotated SVG so labels and colors match.

export const FIELD_LABELS: Record<string, string> = {
  vendorName: "Vendor",
  invoiceNumber: "Invoice #",
  invoiceDate: "Invoice date",
  poNumber: "PO",
  grnNumber: "GRN / gate pass",
  projectCode: "Project ref.",
  subtotal: "Subtotal",
  salesTax: "Sales tax",
  total: "Total",
};

export type ConfidenceBand = "high" | "medium" | "low";

export function confidenceBand(c: number | undefined): ConfidenceBand {
  if (c === undefined || c >= 0.9) return "high";
  if (c >= 0.75) return "medium";
  return "low";
}

export const CONFIDENCE_COLORS: Record<ConfidenceBand, { stroke: string; fill: string; text: string; label: string }> = {
  high: { stroke: "#067647", fill: "#ecfdf3", text: "#05603a", label: "≥ 0.90" },
  medium: { stroke: "#b54708", fill: "#fffaeb", text: "#93370d", label: "0.75 – 0.89" },
  low: { stroke: "#b42318", fill: "#fef3f2", text: "#912018", label: "< 0.75" },
};

/** Neutral styling for a field that was not extracted (null). */
export const NOT_EXTRACTED_COLORS = { stroke: "#98a2b3", fill: "#f8fafc", text: "#475467" } as const;

/**
 * D-37 chip: grounding state + the OCR layer's confidence (fixture or Tesseract), never the model's self-report.
 * Red when the value is not in the OCR text or OCR < 0.75 (the R-14 triggers), amber 0.75-0.89, green otherwise.
 */
export function chipFor(check: "found" | "not_found" | "not_extracted" | undefined, ocrConfidence: number | undefined) {
  if (check === "not_extracted") return { text: "— not extracted", band: null, colors: NOT_EXTRACTED_COLORS };
  const ocr = ocrConfidence !== undefined ? ` · OCR ${ocrConfidence.toFixed(2)}` : "";
  const band: ConfidenceBand = check === "not_found" ? "low" : confidenceBand(ocrConfidence);
  const mark = check === "not_found" ? "✗ not found" : check === "found" ? "✓ found" : "OCR";
  return { text: check === undefined ? `OCR ${ocrConfidence?.toFixed(2) ?? "n/a"}` : `${mark}${ocr}`, band, colors: CONFIDENCE_COLORS[band] };
}

export type PresenceChipState = "present" | "absent" | "unreadable" | "conflict";

/**
 * D-44 chip for a critical field: the presence state decides the wording, grounding + OCR the rest.
 * present → the D-37 chip; unreadable → "✗ not found" (a value not in the text, or a label with no value);
 * absent → "— absent" (the document has no such field); conflict → "≠ conflict" (two different values).
 */
export function presenceChipFor(state: PresenceChipState | undefined, check: "found" | "not_found" | "not_extracted" | undefined, ocrConfidence: number | undefined) {
  switch (state) {
    case "absent":
      return { text: "— absent", band: null, colors: NOT_EXTRACTED_COLORS };
    case "conflict":
      return { text: "≠ conflict", band: "low" as const, colors: CONFIDENCE_COLORS.low };
    case "unreadable":
      return check === "not_found" ? chipFor(check, ocrConfidence) : { text: "✗ not found · label, no value", band: "low" as const, colors: CONFIDENCE_COLORS.low };
    default:
      return chipFor(check, ocrConfidence);
  }
}

const usd = (n: number | null) =>
  n === null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

export function fieldValue(e: Extraction, field: string): string {
  switch (field) {
    case "vendorName":
      return e.vendor.name ?? "—";
    case "invoiceNumber":
      return e.invoiceNumber ?? "—";
    case "invoiceDate":
      return e.invoiceDate ?? "—";
    case "poNumber":
      return e.poNumber ?? "—";
    case "grnNumber":
      return [e.grnNumber, e.gatePassNumber].filter(Boolean).join(" / ") || "—";
    case "projectCode":
      return e.projectCode ?? "—";
    case "subtotal":
      return usd(e.subtotal);
    case "salesTax":
      return usd(e.salesTax);
    case "total":
      return usd(e.total);
    default:
      return "—";
  }
}
