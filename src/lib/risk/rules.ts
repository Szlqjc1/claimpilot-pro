import {
  CAPITALIZATION_THRESHOLD_CENTS,
  ENTERTAINMENT_POLICY,
  STATE_TAX_RANGES,
  TRAVEL_POLICY,
  approvalRank,
  requiredApprovalLevel,
} from "@/lib/domain/constants";
import { formatUsd, toCents } from "@/lib/domain/money";
import { isWeekend, toIsoDate } from "@/lib/domain/dates";
import { totalsGap } from "@/lib/domain/schemas";
import { isRequired } from "@/lib/domain/field-policy";
import type { Finding, RiskInput } from "./types";

type Rule = { id: string; evaluate: (input: RiskInput, prior: Finding[]) => Finding | null };

const DAY_MS = 86_400_000;
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

/** Lowercase, drop punctuation and legal suffixes so "Midwest Proving Grounds, L.L.C." == "MIDWEST PROVING GROUNDS LLC". */
export function normalizeVendorName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !["llc", "inc", "incorporated", "corp", "corporation", "co", "company", "ltd", "the"].includes(w))
    .join(" ");
}

export function normalizeInvoiceNumber(inv: string | null | undefined): string | null {
  return inv ? inv.toUpperCase().replace(/[^A-Z0-9]/g, "") : null;
}

function stateFromAddress(address: string | null | undefined): string | null {
  const matches = address ? [...address.matchAll(/,\s*([A-Z]{2})\b/g)] : [];
  return matches.length ? matches[matches.length - 1][1] : null;
}

const CRITICAL_FIELDS = ["vendorName", "invoiceNumber", "invoiceDate", "poNumber", "total"] as const;

export const RULES: Rule[] = [
  {
    id: "R-01",
    evaluate: ({ claim, extraction, policy, po }) => {
      if (!policy.requiresProjectCode) return null;
      const claimMissing = !claim.projectCode;
      const invoiceMissing = !extraction.projectCode && !po?.projectCode;
      if (!claimMissing && !invoiceMissing) return null;
      return {
        ruleId: "R-01",
        anomalyType: "Missing Project Code",
        riskLevel: "High",
        points: 40,
        message: claimMissing
          ? `${claim.category} requires a SAP project code; none was entered on the claim.`
          : "The invoice carries no project reference and no PO ties it to a project.",
        evidence: { claimProjectCode: claim.projectCode, invoiceProjectCode: extraction.projectCode, poProjectCode: po?.projectCode ?? null },
      };
    },
  },
  {
    id: "R-02",
    evaluate: ({ claim, extraction, po }, prior) => {
      if (!claim.projectCode || prior.some((f) => f.ruleId === "R-01")) return null;
      const invoiceCode = extraction.projectCode;
      const mismatches: string[] = [];
      if (invoiceCode && invoiceCode !== claim.projectCode) mismatches.push(`invoice references ${invoiceCode}`);
      if (po && po.projectCode !== claim.projectCode) mismatches.push(`PO ${po.poNumber} is booked to ${po.projectCode}`);
      if (mismatches.length === 0) return null;
      return {
        ruleId: "R-02",
        anomalyType: "Missing Project Code",
        riskLevel: "High",
        points: 40,
        message: `Project code mismatch: claim is coded ${claim.projectCode} but ${mismatches.join(" and ")}.`,
        evidence: { claimProjectCode: claim.projectCode, invoiceProjectCode: invoiceCode, poProjectCode: po?.projectCode ?? null },
      };
    },
  },
  {
    id: "R-03",
    evaluate: ({ claim, extraction, history }) => {
      const vendorKey = normalizeVendorName(extraction.vendor.name ?? claim.vendorName);
      const invKey = normalizeInvoiceNumber(extraction.invoiceNumber ?? claim.invoiceNumber);
      const windowStart = claim.submittedAt.getTime() - 90 * DAY_MS;
      const sameVendor = history.filter(
        (h) => h.claimId !== claim.claimId && normalizeVendorName(h.vendorName) === vendorKey,
      );
      const exact = invKey ? sameVendor.find((h) => normalizeInvoiceNumber(h.invoiceNumber) === invKey) : undefined;
      const near =
        exact ??
        sameVendor.find(
          (h) =>
            h.submittedAt.getTime() >= windowStart &&
            Math.abs(h.amountCents - claim.amountCents) <= claim.amountCents * 0.02,
        );
      if (!near) return null;
      return {
        ruleId: "R-03",
        anomalyType: "Duplicate Supplier Invoice",
        riskLevel: "High",
        points: 60,
        message: exact
          ? `Invoice ${claim.invoiceNumber} from ${claim.vendorName} was already submitted on ${near.claimId}.`
          : `${claim.vendorName} billed ${formatUsd(near.amountCents)} on ${near.claimId} (invoice ${near.invoiceNumber ?? "n/a"}) within 90 days — amount within 2% of this invoice.`,
        evidence: {
          matchType: exact ? "same vendor + invoice number" : "same vendor + amount within 2% in 90 days",
          matchedClaimId: near.claimId,
          matchedInvoice: near.invoiceNumber,
          matchedAmount: formatUsd(near.amountCents),
          matchedSubmittedAt: toIsoDate(near.submittedAt),
          normalizedVendor: vendorKey,
        },
      };
    },
  },
  {
    id: "R-04",
    evaluate: ({ claim, policy }) => {
      const ratio = claim.amountCents / policy.perClaimLimitCents;
      const evidence = { amount: formatUsd(claim.amountCents), limit: formatUsd(policy.perClaimLimitCents), utilization: pct(ratio) };
      if (ratio > 1) {
        return {
          ruleId: "R-04",
          anomalyType: "Amount Over Limit",
          riskLevel: "High",
          points: 40,
          message: `${formatUsd(claim.amountCents)} exceeds the ${claim.category} per-claim limit of ${formatUsd(policy.perClaimLimitCents)} (${pct(ratio)}).`,
          evidence,
        };
      }
      // Near-limit advisory applies only where the per-claim limit is the sole spend control (no PO).
      if (ratio >= 0.8 && !claim.poNumber) {
        return {
          ruleId: "R-04",
          anomalyType: "Amount Over Limit",
          riskLevel: "Medium",
          points: 20,
          message: `${formatUsd(claim.amountCents)} is ${pct(ratio)} of the ${claim.category} limit with no PO covering it.`,
          evidence,
        };
      }
      return null;
    },
  },
  {
    id: "R-05",
    evaluate: ({ claim, policy, grn, extraction }) => {
      if (!policy.requiresGrn || grn) return null;
      return {
        ruleId: "R-05",
        anomalyType: "Missing Factory Gate Pass",
        riskLevel: "High",
        points: 30,
        message: `${claim.category} requires a goods receipt / factory gate pass; none found in SAP for PO ${claim.poNumber ?? "—"}.`,
        evidence: { poNumber: claim.poNumber, claimGrn: claim.grnNumber, invoiceGrn: extraction.grnNumber, invoiceGatePass: extraction.gatePassNumber },
      };
    },
  },
  {
    id: "R-06",
    evaluate: ({ claim, vendor }) => {
      const asOf = claim.submittedAt.getTime();
      const problems: string[] = [];
      if (!vendor) problems.push("vendor not found in the vendor master");
      else {
        if (!vendor.approved) problems.push("vendor is not on the approved supplier list");
        if (!vendor.w9OnFile) problems.push("no W-9 on file");
        else if (vendor.w9ExpiresAt && vendor.w9ExpiresAt.getTime() < asOf) problems.push(`W-9 expired ${toIsoDate(vendor.w9ExpiresAt)}`);
        if (vendor.insuranceExpiresAt && vendor.insuranceExpiresAt.getTime() < asOf)
          problems.push(`certificate of insurance expired ${toIsoDate(vendor.insuranceExpiresAt)}`);
      }
      if (problems.length === 0) return null;
      return {
        ruleId: "R-06",
        anomalyType: "Vendor Not Approved",
        riskLevel: "High",
        points: 35,
        message: `${claim.vendorName}: ${problems.join("; ")}.`,
        evidence: {
          approved: vendor?.approved ?? null,
          w9OnFile: vendor?.w9OnFile ?? null,
          w9ExpiresAt: vendor?.w9ExpiresAt ? toIsoDate(vendor.w9ExpiresAt) : null,
          insuranceExpiresAt: vendor?.insuranceExpiresAt ? toIsoDate(vendor.insuranceExpiresAt) : null,
        },
      };
    },
  },
  {
    id: "R-07",
    evaluate: ({ claim, policy, po }) => {
      if (!po) {
        if (!policy.requiresPo) return null;
        return {
          ruleId: "R-07",
          anomalyType: "PO Balance Exceeded",
          riskLevel: "High",
          points: 30,
          message: `${claim.category} requires a purchase order; no PO was referenced or found in SAP.`,
          evidence: { poNumber: claim.poNumber },
        };
      }
      const remaining = po.amountCents - po.consumedCents;
      if (claim.amountCents <= remaining) return null;
      return {
        ruleId: "R-07",
        anomalyType: "PO Balance Exceeded",
        riskLevel: "High",
        points: 30,
        message: `Invoice ${formatUsd(claim.amountCents)} exceeds PO ${po.poNumber} remaining balance of ${formatUsd(remaining)} by ${formatUsd(claim.amountCents - remaining)}.`,
        evidence: {
          poNumber: po.poNumber,
          poAmount: formatUsd(po.amountCents),
          alreadyConsumed: formatUsd(po.consumedCents),
          remaining: formatUsd(remaining),
          invoice: formatUsd(claim.amountCents),
          shortfall: formatUsd(claim.amountCents - remaining),
        },
      };
    },
  },
  {
    id: "R-08",
    evaluate: ({ extraction, benchmarks }) => {
      let worst: { partNumber: string; unitPrice: number; p50: number; variance: number; description: string } | null = null;
      for (const li of extraction.lineItems) {
        const bm = li.partNumber ? benchmarks.find((b) => b.itemCode === li.partNumber) : undefined;
        if (!bm || bm.p50Cents <= 0) continue;
        const variance = (toCents(li.unitPrice) - bm.p50Cents) / bm.p50Cents;
        if (!worst || variance > worst.variance)
          worst = { partNumber: bm.itemCode, unitPrice: toCents(li.unitPrice), p50: bm.p50Cents, variance, description: bm.description };
      }
      if (!worst || worst.variance <= 0.15) return null;
      const points = worst.variance > 0.3 ? 25 : 15;
      return {
        ruleId: "R-08",
        anomalyType: "Price Variance vs Benchmark",
        riskLevel: "Medium",
        points,
        message: `${worst.partNumber} (${worst.description}) billed at ${formatUsd(worst.unitPrice)} vs benchmark p50 ${formatUsd(worst.p50)} (+${pct(worst.variance)}).`,
        evidence: { itemCode: worst.partNumber, unitPrice: formatUsd(worst.unitPrice), benchmarkP50: formatUsd(worst.p50), variance: pct(worst.variance) },
      };
    },
  },
  {
    id: "R-09",
    evaluate: ({ claim, policy, history }) => {
      const inBand = (cents: number) => cents >= policy.perClaimLimitCents * 0.8 && cents < policy.perClaimLimitCents;
      if (!inBand(claim.amountCents)) return null;
      const vendorKey = normalizeVendorName(claim.vendorName);
      const siblings = history.filter(
        (h) =>
          normalizeVendorName(h.vendorName) === vendorKey &&
          Math.abs(h.submittedAt.getTime() - claim.submittedAt.getTime()) <= 7 * DAY_MS &&
          inBand(h.amountCents),
      );
      if (siblings.length === 0) return null;
      return {
        ruleId: "R-09",
        anomalyType: "Split Invoice Suspected",
        riskLevel: "Medium",
        points: 25,
        message: `${siblings.length + 1} invoices from ${claim.vendorName} within 7 days, each 80–99% of the ${formatUsd(policy.perClaimLimitCents)} limit.`,
        evidence: { relatedClaims: siblings.map((s) => `${s.claimId} (${formatUsd(s.amountCents)})`), limit: formatUsd(policy.perClaimLimitCents) },
      };
    },
  },
  {
    id: "R-10",
    evaluate: ({ extraction }) => {
      const gap = totalsGap(extraction);
      const state = stateFromAddress(extraction.shipTo.address);
      const range = state ? STATE_TAX_RANGES[state] : undefined;
      const rate = extraction.taxRate ?? 0;
      const rateImplausible = rate > 0 && (range ? rate < range[0] - 0.0001 || rate > range[1] + 0.0001 : rate > 0.1025);
      if (Math.abs(gap) <= 1 && !rateImplausible) return null;
      const parts: string[] = [];
      if (Math.abs(gap) > 1) parts.push(`line totals plus tax and charges differ from the invoice total by $${Math.abs(gap).toFixed(2)}`);
      if (rateImplausible) parts.push(`tax rate ${pct(rate)} is implausible for ship-to state ${state ?? "unknown"}`);
      return {
        ruleId: "R-10",
        anomalyType: "Tax Calculation Mismatch",
        riskLevel: "Medium",
        points: 20,
        message: `Tax check failed: ${parts.join("; ")}.`,
        evidence: {
          subtotal: extraction.subtotal,
          salesTax: extraction.salesTax,
          freight: extraction.freight,
          otherCharges: extraction.otherCharges,
          total: extraction.total,
          gap,
          taxRate: rate,
          shipToState: state,
          plausibleRange: range ?? null,
        },
      };
    },
  },
  {
    id: "R-11",
    evaluate: ({ claim, extraction }) => {
      if (claim.category !== "Supplier Audit Travel") return null;
      const violations: string[] = [];
      for (const li of extraction.lineItems) {
        const d = li.description.toLowerCase();
        const unit = toCents(li.unitPrice);
        if (/(lodging|hotel)/.test(d) && unit > TRAVEL_POLICY.lodgingCapPerNightCents)
          violations.push(`Lodging ${formatUsd(unit)}/night vs ${formatUsd(TRAVEL_POLICY.lodgingCapPerNightCents)} cap`);
        if (/airfare/.test(d) && toCents(li.amount) > TRAVEL_POLICY.airfareCapCents)
          violations.push(`Airfare ${formatUsd(toCents(li.amount))} vs ${formatUsd(TRAVEL_POLICY.airfareCapCents)} cap`);
        if (/(business class|first class)/.test(d)) violations.push(`Non-economy fare: ${li.description}`);
        if (/per diem/.test(d) && unit > TRAVEL_POLICY.perDiemCents)
          violations.push(`Per diem ${formatUsd(unit)}/day vs ${formatUsd(TRAVEL_POLICY.perDiemCents)}`);
      }
      if (violations.length === 0) return null;
      return {
        ruleId: "R-11",
        anomalyType: "Travel Policy Violation",
        riskLevel: "Medium",
        points: 25,
        message: `Travel policy: ${violations.join("; ")}.`,
        evidence: { violations },
      };
    },
  },
  {
    id: "R-12",
    evaluate: ({ claim, extraction }) => {
      if (claim.category !== "Client Entertainment") return null;
      const count = extraction.attendees?.count ?? null;
      const names = extraction.attendees?.names ?? [];
      let points = 0;
      const parts: string[] = [];
      const perHead = count && count > 0 ? Math.round(claim.amountCents / count) : null;
      if (perHead !== null && perHead > ENTERTAINMENT_POLICY.perHeadCapCents) {
        points += 25;
        parts.push(`${formatUsd(perHead)} per head vs ${formatUsd(ENTERTAINMENT_POLICY.perHeadCapCents)} cap`);
      }
      const alcohol = extraction.lineItems.filter((li) => /(wine|beer|spirits|alcohol|cocktail|liquor|bar tab)/i.test(li.description));
      if (alcohol.length > 0) {
        points += 10;
        parts.push(`alcohol billed (${alcohol.map((a) => a.description).join(", ")})`);
      }
      if (names.length === 0) {
        points += 15;
        parts.push("attendee list missing");
      }
      if (points === 0) return null;
      return {
        ruleId: "R-12",
        anomalyType: "Entertainment Policy Violation",
        riskLevel: "Medium",
        points,
        message: `Entertainment policy: ${parts.join("; ")}.`,
        evidence: { attendees: count, perHead: perHead !== null ? formatUsd(perHead) : null, alcoholLines: alcohol.length, attendeeListProvided: names.length > 0 },
      };
    },
  },
  {
    id: "R-13",
    evaluate: ({ claim, extraction, project }) => {
      const d = extraction.invoiceDate;
      if (!d) return null;
      const problems: string[] = [];
      if (d > toIsoDate(claim.submittedAt)) problems.push(`invoice dated ${d}, after the claim was submitted`);
      if (project?.endDate && d > toIsoDate(project.endDate)) problems.push(`invoice dated after project ${project.code} closed on ${toIsoDate(project.endDate)}`);
      if (claim.category === "Client Entertainment" && isWeekend(d)) problems.push(`business meal on a weekend (${d})`);
      if (problems.length === 0) return null;
      return {
        ruleId: "R-13",
        anomalyType: "Invoice Date Anomaly",
        riskLevel: "Low",
        points: 15,
        message: `Date check: ${problems.join("; ")}.`,
        evidence: { invoiceDate: d, submittedAt: toIsoDate(claim.submittedAt), projectEnd: project?.endDate ? toIsoDate(project.endDate) : null },
      };
    },
  },
  {
    id: "R-14",
    evaluate: ({ extraction }) => {
      // D-37, D-44. Three triggers, all from the OCR layer, never from the model's self-reported confidence:
      //   (1) a non-null critical value that is not in the OCR text (fieldChecks "not_found", attached before scoring);
      //   (2) the OCR layer's confidence for a non-null critical value is below 0.75;
      //   (3) D-44: a null critical value whose label is on the document (fieldPresence "unreadable").
      // A field the document does not have (fieldPresence "absent") never fires R-14; a required one fires R-19.
      const value = (f: (typeof CRITICAL_FIELDS)[number]) => (f === "vendorName" ? extraction.vendor?.name : extraction[f]);
      const isNull = (f: (typeof CRITICAL_FIELDS)[number]) => {
        const v = value(f);
        return v === null || v === undefined || (typeof v === "string" && v.trim() === "") || extraction.fieldChecks?.[f] === "not_extracted";
      };
      const present = CRITICAL_FIELDS.filter((f) => !isNull(f));
      const ungrounded = present.filter((f) => extraction.fieldChecks?.[f] === "not_found");
      const low = present.filter((f) => (extraction.fieldConfidence[f] ?? 1) < 0.75);
      const labelNoValue = CRITICAL_FIELDS.filter((f) => isNull(f) && extraction.fieldPresence?.[f]?.state === "unreadable");
      const flagged = CRITICAL_FIELDS.filter((f) => ungrounded.includes(f) || low.includes(f) || labelNoValue.includes(f));
      if (flagged.length === 0) return null;
      return {
        ruleId: "R-14",
        anomalyType: "Low OCR Confidence",
        riskLevel: "Low",
        points: Math.min(30, 15 * flagged.length),
        message: `Scan too poor to verify ${flagged.join(", ")} — rescan or check ${flagged.length === 1 ? "this field" : "these fields"} manually.`,
        evidence: {
          ...Object.fromEntries(low.map((f) => [f, extraction.fieldConfidence[f]])),
          ...(ungrounded.length ? { notInOcrText: ungrounded } : {}),
          ...(labelNoValue.length ? { labelWithoutValue: labelNoValue } : {}),
        },
      };
    },
  },
  {
    id: "R-15",
    evaluate: ({ claim, extraction }) => {
      const required = requiredApprovalLevel(claim.amountCents);
      const actual = extraction.approval?.level ?? null;
      if (actual && approvalRank(actual) >= approvalRank(required)) return null;
      return {
        ruleId: "R-15",
        anomalyType: "Approval Threshold Breach",
        riskLevel: "Medium",
        points: 20,
        message: actual
          ? `Approved at ${actual} level; ${formatUsd(claim.amountCents)} requires ${required} approval.`
          : `No approval signature on the invoice; ${required} approval required.`,
        evidence: { required, actual, approver: extraction.approval?.name ?? null },
      };
    },
  },
  {
    id: "R-16",
    evaluate: ({ claim, extraction }) => {
      const currency = extraction.currency ?? claim.currency;
      if (currency === "USD" && claim.currency === "USD") return null;
      return {
        ruleId: "R-16",
        anomalyType: "Currency/FX Mismatch",
        riskLevel: "Low",
        points: 15,
        message: `Invoice currency ${currency} does not match the USD claim.`,
        evidence: { invoiceCurrency: currency, claimCurrency: claim.currency },
      };
    },
  },
  {
    id: "R-17",
    evaluate: ({ extraction, vendor }) => {
      const remit = extraction.remitTo;
      if (!vendor || !remit?.accountLast4) return null;
      if (remit.accountLast4 === vendor.bankAccountLast4 && (!remit.bankName || remit.bankName === vendor.bankName)) return null;
      return {
        ruleId: "R-17",
        anomalyType: "Bank Detail Change",
        riskLevel: "High",
        points: 50,
        message: `Remit-to bank on the invoice (${remit.bankName ?? "unknown"} ••${remit.accountLast4}) differs from the vendor master (${vendor.bankName} ••${vendor.bankAccountLast4}).`,
        evidence: { invoiceBank: remit.bankName, invoiceLast4: remit.accountLast4, masterBank: vendor.bankName, masterLast4: vendor.bankAccountLast4 },
      };
    },
  },
  {
    id: "R-18",
    evaluate: ({ claim, po }) => {
      if (claim.category !== "Tooling & Dies" && claim.category !== "Professional Services & Software") return null;
      if (claim.amountCents <= CAPITALIZATION_THRESHOLD_CENTS || po?.costType !== "Expense") return null;
      return {
        ruleId: "R-18",
        anomalyType: "Capitalization Mismatch",
        riskLevel: "Medium",
        points: 20,
        message: `${formatUsd(claim.amountCents)} of ${claim.category.toLowerCase()} exceeds the ${formatUsd(CAPITALIZATION_THRESHOLD_CENTS)} capitalization threshold but PO ${po.poNumber} is expense-coded.`,
        evidence: { poNumber: po.poNumber, costType: po.costType, threshold: formatUsd(CAPITALIZATION_THRESHOLD_CENTS) },
      };
    },
  },
  {
    id: "R-19",
    evaluate: ({ claim, extraction }) => {
      // D-44. Reads fieldPresence (attached before scoring). Two triggers only: a REQUIRED critical field the
      // document does not have, or any critical field the document gives conflicting values for. "unreadable" is
      // R-14's, and an absent optional field (a PO on travel or entertainment) never fires.
      const presence = extraction.fieldPresence;
      if (!presence) return null;
      const missing = CRITICAL_FIELDS.filter((f) => presence[f]?.state === "absent" && isRequired(f, claim));
      const conflicting = CRITICAL_FIELDS.filter((f) => presence[f]?.state === "conflict");
      if (missing.length === 0 && conflicting.length === 0) return null;
      const parts: string[] = [];
      if (missing.length) parts.push(`required ${missing.length === 1 ? "field" : "fields"} missing from the invoice: ${missing.join(", ")}`);
      if (conflicting.length) parts.push(`the invoice gives conflicting values for ${conflicting.join(", ")}`);
      const text = parts.join("; ");
      return {
        ruleId: "R-19",
        anomalyType: "Incomplete or Conflicting Extraction",
        riskLevel: "High",
        points: 20,
        message: `${text[0].toUpperCase()}${text.slice(1)}. Obtain a complete invoice before posting.`,
        evidence: {
          ...(missing.length ? { missing } : {}),
          ...(conflicting.length ? { conflicting: Object.fromEntries(conflicting.map((f) => [f, extraction.fieldCandidates?.[f] ?? []])) } : {}),
        },
      };
    },
  },
];
