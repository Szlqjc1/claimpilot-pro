import { describe, expect, it } from "vitest";
import { computeKpis, delta, exceptionPareto, monthlyTrend, type KpiClaim } from "@/lib/kpi/formulas";
import { buildWatchlist } from "@/lib/kpi/watchlist";

const t0 = new Date("2026-10-01T12:00:00Z");
const claim = (over: Partial<KpiClaim>): KpiClaim => ({
  claimId: "CLM-2026-0001",
  amountCents: 100_000,
  status: "Analyzed",
  decision: "AUTO_APPROVE",
  riskLevel: "Low",
  submittedAt: t0,
  analyzedAt: new Date(t0.getTime() + 4 * 3_600_000),
  department: "Supply Chain",
  category: "Factory Logistics",
  projectCode: "PRJ-A",
  vendorName: "Vendor A",
  exceptions: [],
  lineItems: [],
  ...over,
});

const rows: KpiClaim[] = [
  claim({ claimId: "C1" }),
  claim({ claimId: "C2", amountCents: 300_000, decision: "ESCALATE", riskLevel: "High", analyzedAt: new Date(t0.getTime() + 8 * 3_600_000), exceptions: [{ anomalyType: "Duplicate Supplier Invoice", status: "Open", riskLevel: "High" }] }),
  claim({ claimId: "C3", status: "Posted", decision: "REVIEW", riskLevel: "Low", exceptions: [{ anomalyType: "Low OCR Confidence", status: "Waived", riskLevel: "Low" }] }),
  claim({ claimId: "C4", status: "Pending", decision: null, riskLevel: null, analyzedAt: null, amountCents: 50_000 }),
];

describe("computeKpis", () => {
  const k = computeKpis(rows, [], [{ code: "PRJ-A", name: "A", budgetCents: 1_100_000 }]);
  it("sums spend and counts scope (all statuses)", () => {
    expect(k.totalSpendCents).toBe(550_000);
    expect(k.claimsInScope).toBe(4);
  });
  it("auto-clear and exception rates use analyzed/posted as denominator", () => {
    expect(k.analyzedCount).toBe(3);
    expect(k.autoClearRate).toBeCloseTo(1 / 3);
    expect(k.exceptionRate).toBeCloseTo(2 / 3);
    expect(k.openExceptionClaims).toBe(1);
  });
  it("high-risk exposure, duplicate recovery, OCR straight-through", () => {
    expect(k.highRiskExposureCents).toBe(300_000);
    expect(k.duplicateRecoveryCents).toBe(300_000);
    expect(k.ocrStraightThroughRate).toBeCloseTo(2 / 3);
  });
  it("average cycle time in hours", () => {
    expect(k.avgCycleHours).toBeCloseTo((4 + 8 + 4) / 3);
  });
  it("budget utilization", () => {
    expect(k.budgetUtilization).toBeCloseTo(0.5);
  });
  it("benchmark variance is amount-weighted", () => {
    const b = computeKpis(
      [claim({ lineItems: [{ partNumber: "X", unitPrice: 110, amount: 1000 }, { partNumber: "Y", unitPrice: 100, amount: 3000 }] })],
      [{ itemCode: "X", p50Cents: 10_000 }, { itemCode: "Y", p50Cents: 10_000 }],
      [],
    );
    expect(b.benchmarkVariance).toBeCloseTo(0.025);
  });
  it("empty period returns zeros, not NaN", () => {
    const e = computeKpis([], [], []);
    for (const v of Object.values(e)) {
      expect(Number.isNaN(v)).toBe(false);
      expect(v).toBe(0);
    }
  });
});

describe("helpers", () => {
  it("delta handles a zero prior period", () => {
    expect(delta(10, 0)).toBeNull();
    expect(delta(0, 0)).toBe(0);
    expect(delta(15, 10)).toBeCloseTo(0.5);
  });
  it("monthly trend has 12 buckets ending at the anchor month", () => {
    const t = monthlyTrend(rows, new Date("2026-10-29T00:00:00Z"));
    expect(t).toHaveLength(12);
    expect(t[11].key).toBe("2026-10");
    expect(t[11].spend).toBe(5_500);
  });
  it("Pareto sorts by count", () => {
    expect(exceptionPareto(rows)[0].count).toBe(1);
  });
  it("watchlist is capped at 3 and sorted by severity", () => {
    const w = buildWatchlist({
      periodClaims: rows.map((r) => ({ ...r, amountCents: r.amountCents * 100 })),
      allClaims: rows,
      projects: [{ code: "PRJ-A", name: "A", budgetCents: 1_000_000 }],
      benchmarks: [],
      asOf: t0,
    });
    expect(w.length).toBeLessThanOrEqual(3);
    expect(w[0].severity).toBe("High");
  });
});
