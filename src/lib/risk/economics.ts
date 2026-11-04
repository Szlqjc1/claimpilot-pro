import { CONSTRAINT_RULES } from "@/lib/domain/constants";
import type { Finding } from "./types";

// Review economics (docs/ECONOMICS.md): review a claim when the expected loss of paying it unreviewed,
// p × L, exceeds the cost of reviewing it, c. Pure; computed beside the risk engine, never inside it.

export type Economics = {
  exposureCents: number;
  expectedLossCents: number; // p × L
  reviewCostCents: number;
  priority: number; // expectedLossCents / reviewCostCents
  breakEvenProbability: number; // c / (L + c)
  action: "REVIEW" | "CLEAR";
  reason: "CONSTRAINT" | "EXPECTED_LOSS" | "BELOW_COST";
};

const CONSTRAINTS = new Set<string>(CONSTRAINT_RULES);

export function economicsFor(input: { findings: Pick<Finding, "ruleId">[]; exposureCents: number; probability: number; reviewCostCents: number }): Economics {
  const L = Math.max(0, input.exposureCents);
  const c = input.reviewCostCents;
  const expectedLossCents = input.probability * L;
  const priority = L === 0 || c <= 0 ? 0 : expectedLossCents / c;
  const base = { exposureCents: L, expectedLossCents, reviewCostCents: c, priority, breakEvenProbability: c / (L + c) };

  // Fraud controls are constraints, not an expected-value optimisation: heavy tails and non-monetary penalties.
  if (input.findings.some((f) => CONSTRAINTS.has(f.ruleId))) return { ...base, action: "REVIEW", reason: "CONSTRAINT" };
  if (L === 0) return { ...base, priority: 0, action: "CLEAR", reason: "BELOW_COST" };
  return expectedLossCents > c ? { ...base, action: "REVIEW", reason: "EXPECTED_LOSS" } : { ...base, action: "CLEAR", reason: "BELOW_COST" };
}

export type CurvePoint = { capacityPct: number; reviewed: number; reviewCostCents: number; expectedLossCents: number; totalCents: number };

/**
 * Cost curve: for each review capacity (share of claims), review the highest-priority claims first;
 * total = reviewed × c + Σ p·L over the claims not reviewed. Pure, so the script and tests share it.
 */
export function costCurve(claims: { priority: number; expectedLossCents: number }[], costPerReviewCents: number, capacities: number[]): CurvePoint[] {
  const ranked = [...claims].sort((a, b) => b.priority - a.priority);
  return capacities.map((capacityPct) => {
    const reviewed = Math.round((ranked.length * capacityPct) / 100);
    const expectedLossCents = Math.round(ranked.slice(reviewed).reduce((s, x) => s + x.expectedLossCents, 0));
    const reviewCostCents = reviewed * costPerReviewCents;
    return { capacityPct, reviewed, reviewCostCents, expectedLossCents, totalCents: reviewCostCents + expectedLossCents };
  });
}

/** 0 → 40 % in 2.5 % steps. */
export const CURVE_CAPACITIES = Array.from({ length: 17 }, (_, i) => i * 2.5);
