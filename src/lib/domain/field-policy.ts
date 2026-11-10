// Which critical fields a claim must carry (Task 13 A3, D-44). Pure. R-19 escalates a required field that is
// absent; an optional field that is absent never escalates.
import type { CriticalField } from "@/lib/ai/labels";

/** A PO is required at or above this amount, for procurement categories only. */
export const PO_REQUIRED_FROM_CENTS = 100_000; // $1,000

/**
 * Off-site spend never carries a PO, at any amount. All 15 seeded claims without a PO number are in these two
 * categories ($591–$3,004); an amount-only threshold would escalate 13 of them, including hero CLM-2026-0147.
 */
export const PO_EXEMPT_CATEGORIES: readonly string[] = ["Supplier Audit Travel", "Client Entertainment"];

export function isRequired(field: CriticalField, claim: { amountCents: number; category: string }): boolean {
  if (field !== "poNumber") return true; // vendorName, invoiceNumber, invoiceDate, total
  return claim.amountCents >= PO_REQUIRED_FROM_CENTS && !PO_EXEMPT_CATEGORIES.includes(claim.category);
}
