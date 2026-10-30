import type { Category, ClaimStatus, Decision, Department, RiskLevel } from "@/lib/domain/constants";
import type { InvoiceDoc, InvoiceLine } from "@/lib/receipts/invoice";
import { vendorByName } from "./master";
import { addDays, isoDate, toIsoDate } from "@/lib/domain/dates";

export type ClaimSeed = {
  claimId: string;
  employee: string;
  department: Department;
  projectCode: string | null;
  category: Category;
  vendorName: string;
  poNumber: string | null;
  grnNumber: string | null;
  submittedAt: Date;
  status: ClaimStatus;
  /** Hours from submission to AI analysis (historical analyzed/posted claims). */
  cycleHours?: number;
  postedAt?: Date;
  doc: InvoiceDoc;
  story?: string;
  expected?: { score: number; level: RiskLevel; decision: Decision };
  /** Generator intent, used only for seed-time sanity checks. */
  plannedAnomaly?: string | null;
};

export function makeDoc(input: {
  claimId: string;
  vendor: string;
  invoiceNumber: string;
  invoiceDate: string;
  poNumber: string | null;
  grnNumber?: string | null;
  gatePassNumber?: string | null;
  projectCode: string | null;
  shipTo: { plant: string; address: string };
  lines: InvoiceLine[];
  taxRate?: number;
  salesTaxCents?: number;
  freightCents?: number;
  otherChargesCents?: number;
  otherChargesLabel?: string;
  approval: { name: string; level: string } | null;
  attendees?: { count: number; names: string[] } | null;
  notes?: string[];
  confidence?: Partial<Record<string, number>>;
  bankOverride?: { bankName: string; accountLast4: string };
  releaseNumber?: string | null;
}): InvoiceDoc {
  const v = vendorByName(input.vendor);
  const terms = v.paymentTerms;
  const days = Number(terms.match(/\d+/)?.[0] ?? 60);
  return {
    claimId: input.claimId,
    vendor: {
      name: v.name,
      taxId: v.taxId,
      street: v.street,
      cityState: `${v.city}, ${v.state}`,
      bankName: input.bankOverride?.bankName ?? v.bankName,
      accountLast4: input.bankOverride?.accountLast4 ?? v.bankAccountLast4,
    },
    invoiceNumber: input.invoiceNumber,
    invoiceDate: input.invoiceDate,
    dueDate: toIsoDate(addDays(isoDate(input.invoiceDate), days)),
    paymentTerms: terms,
    poNumber: input.poNumber,
    releaseNumber: input.releaseNumber ?? null,
    grnNumber: input.grnNumber ?? null,
    gatePassNumber: input.gatePassNumber ?? null,
    projectCode: input.projectCode,
    shipTo: input.shipTo,
    lines: input.lines,
    taxRate: input.taxRate ?? 0,
    salesTaxCents: input.salesTaxCents ?? 0,
    freightCents: input.freightCents ?? 0,
    otherChargesCents: input.otherChargesCents ?? 0,
    otherChargesLabel: input.otherChargesLabel ?? "Other charges",
    approval: input.approval,
    attendees: input.attendees ?? null,
    notes: input.notes ?? [],
    confidence: input.confidence ?? {},
  };
}
