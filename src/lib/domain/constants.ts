// Single source of truth for every enum-like string stored in the database.

export const DEPARTMENTS = [
  "R&D Engineering",
  "Supplier Quality",
  "Plant Operations",
  "Supply Chain",
] as const;
export type Department = (typeof DEPARTMENTS)[number];

export const CATEGORIES = [
  "Supplier Audit Travel",
  "Prototype Material",
  "R&D Track Testing",
  "Factory Logistics",
  "Client Entertainment",
  "Direct Parts Procurement",
  "Tooling & Dies",
  "MRO & Equipment Repair",
  "Professional Services & Software",
  "Warranty & Containment",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const ANOMALY_TYPES = [
  "Missing Project Code",
  "Duplicate Supplier Invoice",
  "Amount Over Limit",
  "Missing Factory Gate Pass",
  "Vendor Not Approved",
  "PO Balance Exceeded",
  "Price Variance vs Benchmark",
  "Split Invoice Suspected",
  "Tax Calculation Mismatch",
  "Travel Policy Violation",
  "Entertainment Policy Violation",
  "Invoice Date Anomaly",
  "Low OCR Confidence",
  "Approval Threshold Breach",
  "Currency/FX Mismatch",
  "Bank Detail Change",
  "Capitalization Mismatch",
  "Incomplete or Conflicting Extraction",
] as const;
export type AnomalyType = (typeof ANOMALY_TYPES)[number];

export const CLAIM_STATUSES = ["Pending", "Analyzed", "Posted"] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export const RISK_LEVELS = ["High", "Medium", "Low"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const DECISIONS = ["AUTO_APPROVE", "REVIEW", "ESCALATE"] as const;
export type Decision = (typeof DECISIONS)[number];

export const EXCEPTION_STATUSES = ["Open", "Resolved", "Waived", "Dismissed"] as const;
export type ExceptionStatus = (typeof EXCEPTION_STATUSES)[number];
/**
 * A reviewer's disposition of an exception: ONE dimension, not status × reason (D-39), so impossible pairs such as
 * "resolved but a false alarm" cannot exist in the data.
 */
export const DISPOSITIONS = ["Resolved", "Waived", "Dismissed"] as const;
export type Disposition = (typeof DISPOSITIONS)[number];
export const DISPOSITION_MEANING: Record<Disposition, string> = {
  Resolved: "Real issue, corrected (e.g. the missing document or the right value was obtained).",
  Waived: "Real issue, accepted for a business reason (e.g. an approved exception to policy).",
  Dismissed: "The rule was wrong here: a false alarm, nothing to correct or accept.",
};
export const DISPOSITION_ACTION: Record<Disposition, string> = {
  Resolved: "Exception Resolved",
  Waived: "Exception Waived",
  Dismissed: "Exception Dismissed",
};

export const AI_RUN_MODES = ["mock", "live", "fallback"] as const;
export type AiRunMode = (typeof AI_RUN_MODES)[number];

export const APPROVAL_LEVELS = ["Manager", "Director", "VP", "CFO"] as const;
export type ApprovalLevel = (typeof APPROVAL_LEVELS)[number];

/** Approval matrix (USD cents, upper bound exclusive). */
export const APPROVAL_MATRIX: { level: ApprovalLevel; minCents: number; maxCents: number | null; label: string }[] = [
  { level: "Manager", minCents: 0, maxCents: 1_000_000, label: "Under $10,000" },
  { level: "Director", minCents: 1_000_000, maxCents: 5_000_000, label: "$10,000 – $50,000" },
  { level: "VP", minCents: 5_000_000, maxCents: 25_000_000, label: "$50,000 – $250,000" },
  { level: "CFO", minCents: 25_000_000, maxCents: null, label: "Above $250,000" },
];

export function requiredApprovalLevel(amountCents: number): ApprovalLevel {
  const row = APPROVAL_MATRIX.find((r) => amountCents >= r.minCents && (r.maxCents === null || amountCents < r.maxCents));
  return row?.level ?? "CFO";
}

export function approvalRank(level: string | null | undefined): number {
  return level ? APPROVAL_LEVELS.indexOf(level as ApprovalLevel) : -1;
}

/** Who a flagged claim is routed to, by department. */
export const ROUTING: Record<Department, string> = {
  "R&D Engineering": "R&D Finance Partner",
  "Supplier Quality": "Supplier Quality Manager",
  "Plant Operations": "Plant Controller",
  "Supply Chain": "Supply Chain Controller",
};

export const TRAVEL_POLICY = {
  lodgingCapPerNightCents: 18_400,
  airfareCapCents: 65_000,
  perDiemCents: 7_400,
  economyOnly: true,
} as const;

export const ENTERTAINMENT_POLICY = {
  perHeadCapCents: 15_000,
  alcoholDiscouraged: true,
  attendeeListRequired: true,
} as const;

export const CAPITALIZATION_THRESHOLD_CENTS = 500_000;

/** Plausible combined state + local sales-tax range per ship-to state (R-10). 0% (exempt) is always plausible. */
export const STATE_TAX_RANGES: Record<string, [number, number]> = {
  MI: [0.06, 0.06],
  OH: [0.0575, 0.08],
  TN: [0.07, 0.0975],
  TX: [0.0625, 0.0825],
  IL: [0.0625, 0.1025],
  IN: [0.07, 0.07],
};

export const AUDIT_ACTOR = "AI-RPA Agent";
export const AUDIT_ACTION_VALIDATED = "Automotive Expense Validated";
export const AUDIT_ACTION_FLAGGED = "Automotive Expense Flagged";
export const AUDIT_DETAILS_VALIDATED = "Invoice matched with SAP project code successfully.";

export const PROMPT_VERSION_EXTRACT = "extract-v2"; // v2 (D-44): fieldCandidates, otherFields, label variants
export const PROMPT_VERSION_NARRATIVE = "risk-narrative-v1";

export const DISPLAY_TIMEZONE = "America/Detroit";

// ─── Review economics (docs/ECONOMICS.md, DECISIONS D-35) ────────────────────
// These are ILLUSTRATIVE DEMO INPUTS, not measured estimates.

/** Illustrative demo input: fully loaded cost of one human review (~15 min of an AP analyst), in cents. */
export const REVIEW_COST_CENTS = 1800;
/** Illustrative demo input: probability that a flagged finding is a real loss if paid unreviewed. */
export const DEFAULT_ERROR_PROBABILITY = 0.02;
/** Illustrative demo input: rules always reviewed, whatever the arithmetic (duplicate payment, bank-detail change). */
export const CONSTRAINT_RULES = ["R-03", "R-17"] as const;
