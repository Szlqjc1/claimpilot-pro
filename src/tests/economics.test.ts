import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { Extraction } from "@/lib/domain/schemas";
import type { Finding, RiskInput } from "@/lib/risk/types";
import { claimExposure, exposureFor } from "@/lib/risk/exposure";
import { CURVE_CAPACITIES, costCurve, economicsFor } from "@/lib/risk/economics";
import { REVIEW_COST_CENTS } from "@/lib/domain/constants";
import { assessClaims } from "@/lib/economics/assess";

// Expected-loss layer (docs/ECONOMICS.md, DECISIONS D-35). Pure except the last block.

afterAll(() => prisma.$disconnect());

function extraction(over: Partial<Extraction> = {}): Extraction {
  return {
    vendor: { name: "Test Vendor", taxId: null, address: null, confidence: 0.99 },
    invoiceNumber: "INV-1",
    invoiceDate: "2026-10-01",
    dueDate: null,
    currency: "USD",
    poNumber: null,
    releaseNumber: null,
    grnNumber: null,
    gatePassNumber: null,
    projectCode: null,
    shipTo: { plant: null, address: null },
    billTo: null,
    paymentTerms: null,
    remitTo: null,
    attendees: null,
    lineItems: [],
    subtotal: null,
    salesTax: null,
    freight: null,
    otherCharges: null,
    total: 0,
    taxRate: null,
    approval: null,
    fieldConfidence: {},
    boundingBoxes: [],
    warnings: [],
    ...over,
  } as Extraction;
}

function input(amountCents: number, over: Partial<RiskInput> = {}): RiskInput {
  return {
    claim: {
      claimId: "CLM-TEST",
      category: "MRO & Equipment Repair",
      amountCents,
      currency: "USD",
      projectCode: null,
      poNumber: null,
      grnNumber: null,
      vendorName: "Test Vendor",
      invoiceNumber: "INV-1",
      submittedAt: new Date("2026-10-01T12:00:00Z"),
    },
    extraction: extraction(),
    vendor: null,
    po: null,
    grn: null,
    policy: { category: "MRO & Equipment Repair", perClaimLimitCents: 2_500_000, requiresPo: true, requiresGrn: true, requiresProjectCode: false },
    project: null,
    benchmarks: [],
    history: [],
    ...over,
  };
}
const f = (ruleId: string, evidence: Record<string, unknown> = {}): Pick<Finding, "ruleId" | "evidence"> => ({ ruleId, evidence });

describe("exposureFor", () => {
  const po = { poNumber: "4500001", projectCode: "P", amountCents: 6_000_000, consumedCents: 1_880_000, costType: "Expense", status: "Open" };
  const lines = [
    { line: 1, partNumber: "BRK-30", description: "Bracket", quantity: 100, unit: "ea", unitPrice: 14.06, amount: 1406, confidence: 0.99 },
    { line: 2, partNumber: "BRK-31", description: "Bracket below p50", quantity: 10, unit: "ea", unitPrice: 9, amount: 90, confidence: 0.99 },
    { line: 3, partNumber: null, description: "Unbenchmarked freight", quantity: 1, unit: "ea", unitPrice: 500, amount: 500, confidence: 0.99 },
  ];
  const benchmarks = [
    { itemCode: "BRK-30", description: "Bracket", p50Cents: 1_000, p90Cents: 1_200 },
    { itemCode: "BRK-31", description: "Bracket", p50Cents: 1_000, p90Cents: 1_200 },
  ];
  const cases: [string, RiskInput, Pick<Finding, "ruleId" | "evidence">, number | null][] = [
    ["R-03 duplicate → full amount", input(632_000), f("R-03"), 632_000],
    ["R-04 over limit → amount − limit", input(5_680_000), f("R-04"), 5_680_000 - 2_500_000],
    ["R-04 near-limit advisory → not priced", input(2_100_000), f("R-04"), null],
    ["R-07 PO exceeded → amount − remaining", input(5_680_000, { po }), f("R-07"), 5_680_000 - (6_000_000 - 1_880_000)],
    ["R-07 no PO → full amount", input(1_000_000), f("R-07"), 1_000_000],
    ["R-08 → Σ (unit − p50) × qty over benchmarked lines", input(199_600, { extraction: extraction({ lineItems: lines }), benchmarks }), f("R-08"), (1_406 - 1_000) * 100],
    ["R-08 no line items → amount × v / (1 + v)", input(140_600, { extraction: extraction({ lineItems: [] }) }), f("R-08", { variance: "40.6%" }), 40_600],
    ["R-05 all-or-nothing → full amount", input(1_234_500), f("R-05"), 1_234_500],
    ["R-14 not monetisable → null", input(1_234_500), f("R-14"), null],
  ];
  it.each(cases)("%s", (_label, inp, finding, expected) => {
    expect(exposureFor(finding, inp)).toBe(expected);
  });
});

describe("claimExposure", () => {
  it("caps the summed exposure at the claim amount", () => {
    // R-03 alone is the full amount; with R-04 and R-05 the plain sum is far above the invoice.
    const inp = input(5_680_000);
    const res = claimExposure([f("R-03"), f("R-04"), f("R-05")], inp);
    expect(Object.values(res.byRule).reduce((s, v) => s + v, 0)).toBeGreaterThan(5_680_000);
    expect(res.cents).toBe(5_680_000);
  });
});

describe("economicsFor", () => {
  const c = REVIEW_COST_CENTS;
  it("a constraint rule is REVIEW / CONSTRAINT even when p × L is far below c", () => {
    const e = economicsFor({ findings: [f("R-03")], exposureCents: 100, probability: 0.0001, reviewCostCents: c });
    expect(e.expectedLossCents).toBeLessThan(c);
    expect(e).toMatchObject({ action: "REVIEW", reason: "CONSTRAINT" });
    expect(economicsFor({ findings: [f("R-17")], exposureCents: 0, probability: 0.02, reviewCostCents: c })).toMatchObject({ action: "REVIEW", reason: "CONSTRAINT" });
  });

  it("boundary: p × L just above c → REVIEW; exactly c or just below → CLEAR", () => {
    const p = 0.02; // L = c / p is the indifference point: 1800 / 0.02 = 90,000 cents
    expect(economicsFor({ findings: [f("R-04")], exposureCents: 90_001, probability: p, reviewCostCents: c })).toMatchObject({ action: "REVIEW", reason: "EXPECTED_LOSS" });
    expect(economicsFor({ findings: [f("R-04")], exposureCents: 90_000, probability: p, reviewCostCents: c })).toMatchObject({ action: "CLEAR", reason: "BELOW_COST" });
    expect(economicsFor({ findings: [f("R-04")], exposureCents: 89_999, probability: p, reviewCostCents: c })).toMatchObject({ action: "CLEAR", reason: "BELOW_COST" });
  });

  it("L = 0 → CLEAR / BELOW_COST with priority 0", () => {
    expect(economicsFor({ findings: [f("R-14")], exposureCents: 0, probability: 0.5, reviewCostCents: c })).toMatchObject({ action: "CLEAR", reason: "BELOW_COST", priority: 0 });
  });

  it("monotonicity: a larger claim amount never lowers the expected loss", () => {
    let prev = -1;
    for (let amount = 0; amount <= 8_000_000; amount += 50_000) {
      const inp = input(amount);
      const findings = [f("R-04"), f("R-07"), f("R-08", { variance: "20%" })];
      const { cents } = claimExposure(findings, inp);
      const e = economicsFor({ findings, exposureCents: cents, probability: 0.02, reviewCostCents: c });
      expect(e.expectedLossCents).toBeGreaterThanOrEqual(prev);
      prev = e.expectedLossCents;
    }
  });

  it("break-even probability is c / (L + c), within a cent of indifference", () => {
    const L = 5_680_000;
    const e = economicsFor({ findings: [f("R-04")], exposureCents: L, probability: 0.02, reviewCostCents: c });
    expect(e.breakEvenProbability).toBeCloseTo(c / (L + c), 12);
    // At p*, the expected loss avoided equals the cost of reviewing (p*·L = c·(1 − p*)).
    expect(Math.abs(e.breakEvenProbability * L - c * (1 - e.breakEvenProbability))).toBeLessThan(1);
    // Worked example from docs/ECONOMICS.md: $56,800 at $18 → ≈ 0.032 %.
    expect(e.breakEvenProbability * 100).toBeCloseTo(0.0317, 3);
  });
});

describe("cost curve", () => {
  it("snapshot on a fixed population: 0 % and 20 % totals, and 20 % is cheaper", () => {
    // 10 claims: three large exposures, seven small ones (p = 0.02, c = $18).
    const L = [5_680_000, 632_000, 300_000, 40_000, 30_000, 20_000, 10_000, 5_000, 0, 0];
    const claims = L.map((l) => economicsFor({ findings: [f("R-04")], exposureCents: l, probability: 0.02, reviewCostCents: REVIEW_COST_CENTS }));
    const pts = costCurve(claims, REVIEW_COST_CENTS, CURVE_CAPACITIES);
    const at = (pct: number) => pts.find((p) => p.capacityPct === pct)!;
    expect(at(0)).toMatchObject({ reviewed: 0, reviewCostCents: 0, totalCents: 134_340 });
    expect(at(20)).toMatchObject({ reviewed: 2, reviewCostCents: 3_600, expectedLossCents: 8_100, totalCents: 11_700 });
    expect(at(20).totalCents).toBeLessThan(at(0).totalCents);
  });

  it("on the seeded demo data, reviewing 20 % costs less in total than reviewing nothing", async () => {
    const claims = await assessClaims();
    expect(claims.length).toBeGreaterThan(0);
    const pts = costCurve(claims, REVIEW_COST_CENTS, [0, 20]);
    expect(pts[1].totalCents).toBeLessThan(pts[0].totalCents);
  });
});
