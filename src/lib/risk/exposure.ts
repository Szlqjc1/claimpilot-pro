import { APPROVAL_MATRIX, ENTERTAINMENT_POLICY, STATE_TAX_RANGES, TRAVEL_POLICY } from "@/lib/domain/constants";
import { toCents } from "@/lib/domain/money";
import { normalizeVendorName } from "./rules";
import type { Finding, RiskInput } from "./types";

// Exposure L: the money lost if a finding is ignored and the claim is paid as submitted (docs/ECONOMICS.md).
// Pure and deterministic, computed beside the risk engine; it never changes points, levels or decisions.

const DAY_MS = 86_400_000;
const clamp = (cents: number, max: number) => Math.max(0, Math.min(Math.round(cents), max));
/** 0 means "fired, but nothing monetisable here" → null, so it is not mistaken for a priced exposure. */
const priced = (cents: number, amount: number): number | null => {
  const c = clamp(cents, amount);
  return c > 0 ? c : null;
};

/** Parse "$1,234.56" or "40.6%" from rule evidence (rules store display strings). */
function num(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const n = Number(String(value).replace(/[$,%\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function exposureFor(finding: Pick<Finding, "ruleId" | "evidence">, input: RiskInput): number | null {
  const { claim, extraction, policy, po, benchmarks, history } = input;
  const amount = claim.amountCents;

  switch (finding.ruleId) {
    // All-or-nothing: the whole invoice is at stake (paid twice, wrong cost object, no proof of receipt,
    // unapproved vendor, payment to a changed bank account, mis-capitalised spend).
    case "R-02": // booked to the wrong project: the misallocated amount is the full invoice
    case "R-03": // duplicate: the full invoice is paid twice
    case "R-05": // no gate pass: no evidence the goods arrived
    case "R-06": // vendor not approved / no W-9
    case "R-17": // bank detail change: the payment itself may go to a fraudster
    case "R-18": // expensed capital spend: the full amount is misclassified
      return priced(amount, amount);

    case "R-04": // only the part above the per-claim limit (near-limit advisories price at 0 → null)
      return priced(amount - policy.perClaimLimitCents, amount);

    case "R-07": // above the PO's remaining balance; no PO at all → the whole invoice is unauthorised
      return po ? priced(amount - (po.amountCents - po.consumedCents), amount) : priced(amount, amount);

    case "R-08": {
      // Σ (unit price − benchmark p50) × qty over benchmarked lines billed above p50.
      let over = 0;
      let matched = false;
      for (const li of extraction.lineItems) {
        const bm = li.partNumber ? benchmarks.find((b) => b.itemCode === li.partNumber) : undefined;
        if (!bm) continue;
        matched = true;
        over += Math.max(0, toCents(li.unitPrice) - bm.p50Cents) * li.quantity;
      }
      if (matched) return priced(over, amount);
      // No line items: claim vs benchmark total, from the evidence variance v → amount × v / (1 + v).
      const v = num(finding.evidence.variance);
      return v === null ? null : priced((amount * (v / 100)) / (1 + v / 100), amount);
    }

    case "R-09": {
      // Split invoice: combined in-band spend from the same vendor within 7 days, above the per-claim limit,
      // attributed to this invoice (at most its own amount).
      const band = (c: number) => c >= policy.perClaimLimitCents * 0.8 && c < policy.perClaimLimitCents;
      const key = normalizeVendorName(claim.vendorName);
      const siblings = history.filter(
        (h) => normalizeVendorName(h.vendorName) === key && Math.abs(h.submittedAt.getTime() - claim.submittedAt.getTime()) <= 7 * DAY_MS && band(h.amountCents),
      );
      return priced(amount + siblings.reduce((s, h) => s + h.amountCents, 0) - policy.perClaimLimitCents, amount);
    }

    case "R-10": {
      // Arithmetic gap, plus tax charged above the highest plausible rate for the ship-to state.
      const gap = Math.abs(num(finding.evidence.gap) ?? 0) * 100;
      const state = typeof finding.evidence.shipToState === "string" ? finding.evidence.shipToState : null;
      const maxRate = (state && STATE_TAX_RANGES[state]?.[1]) || 0.1025;
      const overTax = Math.max(0, toCents(extraction.salesTax ?? 0) - toCents(extraction.subtotal ?? 0) * maxRate);
      return priced(gap + overTax, amount);
    }

    case "R-11": {
      // Travel: the excess over each cap.
      let over = 0;
      for (const li of extraction.lineItems) {
        const d = li.description.toLowerCase();
        const unit = toCents(li.unitPrice);
        if (/(lodging|hotel)/.test(d)) over += Math.max(0, unit - TRAVEL_POLICY.lodgingCapPerNightCents) * li.quantity;
        else if (/(airfare|business class|first class)/.test(d)) over += Math.max(0, toCents(li.amount) - TRAVEL_POLICY.airfareCapCents);
        else if (/per diem/.test(d)) over += Math.max(0, unit - TRAVEL_POLICY.perDiemCents) * li.quantity;
      }
      return priced(over, amount);
    }

    case "R-12": {
      // Entertainment: spend above the per-head cap, or the alcohol billed, whichever is larger
      // (alcohol is part of the per-head total, so adding both would double count). A missing attendee
      // list alone is a documentation gap, not a priced loss.
      const count = extraction.attendees?.count ?? 0;
      const overCap = count > 0 ? amount - ENTERTAINMENT_POLICY.perHeadCapCents * count : 0;
      const alcohol = extraction.lineItems
        .filter((li) => /(wine|beer|spirits|alcohol|cocktail|liquor|bar tab)/i.test(li.description))
        .reduce((s, li) => s + toCents(li.amount), 0);
      return priced(Math.max(overCap, alcohol), amount);
    }

    case "R-15": {
      // Approval breach: the amount above what the actual approver may sign; no approver → all of it.
      const actual = typeof finding.evidence.actual === "string" ? APPROVAL_MATRIX.find((r) => r.level === finding.evidence.actual) : undefined;
      return priced(actual?.maxCents != null ? amount - actual.maxCents : amount, amount);
    }

    // R-01 (missing code), R-13 (date anomaly), R-14 (OCR confidence), R-16 (currency): not monetisable.
    default:
      return null;
  }
}

/**
 * Total exposure for a claim: the per-rule exposures summed, then CAPPED AT THE CLAIM AMOUNT.
 * Cap rule: the worst case of paying an invoice is losing the whole invoice. Several findings can each
 * price a slice of the same money (an over-limit amount that is also over the PO balance, a duplicate that
 * is also missing a gate pass), so the plain sum can exceed what is actually at risk.
 */
export function claimExposure(findings: Pick<Finding, "ruleId" | "evidence">[], input: RiskInput): { cents: number; byRule: Record<string, number> } {
  const byRule: Record<string, number> = {};
  for (const f of findings) {
    const l = exposureFor(f, input);
    if (l !== null) byRule[f.ruleId] = (byRule[f.ruleId] ?? 0) + l;
  }
  const sum = Object.values(byRule).reduce((s, v) => s + v, 0);
  return { cents: Math.min(sum, input.claim.amountCents), byRule };
}
