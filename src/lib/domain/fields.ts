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
