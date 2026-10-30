import { describe, expect, it } from "vitest";
import { buildSeedPlan, seedRiskInput } from "@/lib/seed/run";
import { HERO_CLAIMS } from "@/lib/seed/heroes";
import { evaluateRisk, finalLevel, decide } from "@/lib/risk/score";
import { normalizeVendorName } from "@/lib/risk/rules";
import type { Finding, RiskInput } from "@/lib/risk/types";

const plan = buildSeedPlan();
const inputFor = (id: string) => seedRiskInput(plan, plan.claims.find((c) => c.claimId === id)!);

describe("hero claims (Section 8.5)", () => {
  const expected: [string, number, string, string, string[]][] = [
    ["CLM-2026-0142", 0, "Low", "AUTO_APPROVE", []],
    ["CLM-2026-0143", 25, "Medium", "REVIEW", ["R-11"]],
    ["CLM-2026-0144", 100, "High", "ESCALATE", ["R-04", "R-05", "R-07"]],
    ["CLM-2026-0145", 60, "High", "ESCALATE", ["R-03"]],
    ["CLM-2026-0146", 65, "High", "ESCALATE", ["R-02", "R-08"]],
    ["CLM-2026-0147", 50, "Medium", "REVIEW", ["R-12"]],
    ["CLM-2026-0148", 65, "High", "ESCALATE", ["R-06", "R-07"]],
  ];
  it.each(expected)("%s → %i / %s / %s", (id, score, level, decision, rules) => {
    const r = evaluateRisk(inputFor(id));
    expect(r.score).toBe(score);
    expect(r.riskLevel).toBe(level);
    expect(r.decision).toBe(decision);
    expect(r.findings.map((f) => f.ruleId)).toEqual(rules);
  });

  it("covers all seven hero claims", () => {
    expect(HERO_CLAIMS.map((h) => h.claimId)).toEqual(expected.map((e) => e[0]));
  });

  it("is deterministic across runs", () => {
    expect(evaluateRisk(inputFor("CLM-2026-0144"))).toEqual(evaluateRisk(inputFor("CLM-2026-0144")));
  });
});

describe("scoring", () => {
  it("caps the score at 100", () => {
    const base = inputFor("CLM-2026-0144");
    const worse: RiskInput = { ...base, vendor: base.vendor && { ...base.vendor, approved: false } };
    const r = evaluateRisk(worse);
    expect(r.findings.reduce((s, f) => s + f.points, 0)).toBeGreaterThan(100);
    expect(r.score).toBe(100);
  });

  it("applies the severity floor: one High finding is High even below 60 points", () => {
    const f: Finding = { ruleId: "R-05", anomalyType: "Missing Factory Gate Pass", riskLevel: "High", points: 30, message: "", evidence: {} };
    expect(finalLevel(30, [f])).toBe("High");
    expect(decide("High", 1)).toBe("ESCALATE");
  });

  it("Low with findings is REVIEW, never AUTO_APPROVE", () => {
    expect(decide("Low", 1)).toBe("REVIEW");
    expect(decide("Low", 0)).toBe("AUTO_APPROVE");
  });

  it("score bands", () => {
    expect(finalLevel(24, [])).toBe("Low");
    expect(finalLevel(25, [])).toBe("Medium");
    expect(finalLevel(59, [])).toBe("Medium");
    expect(finalLevel(60, [])).toBe("High");
  });
});

describe("duplicate detection", () => {
  it("normalizes vendor names", () => {
    expect(normalizeVendorName("Midwest Proving Grounds, L.L.C.")).toBe(normalizeVendorName("MIDWEST PROVING GROUNDS LLC"));
    expect(normalizeVendorName("Great Lakes Die & Tool")).toBe(normalizeVendorName("Great Lakes Die and Tool Inc."));
    expect(normalizeVendorName("Buckeye Freight Systems")).not.toBe(normalizeVendorName("Buckeye Fastener Supply"));
  });

  const base = inputFor("CLM-2026-0142");
  const hist = (amountCents: number, days: number, invoice = "MPG-10001", vendor = "Midwest Proving Grounds, L.L.C.") => ({
    claimId: "CLM-2026-0001",
    vendorName: vendor,
    invoiceNumber: invoice,
    amountCents,
    submittedAt: new Date(base.claim.submittedAt.getTime() - days * 86_400_000),
  });

  it("flags same vendor + amount within 2% inside 90 days", () => {
    expect(evaluateRisk({ ...base, history: [hist(1_430_000, 30)] }).findings.map((f) => f.ruleId)).toContain("R-03");
  });
  it("ignores amounts more than 2% apart", () => {
    expect(evaluateRisk({ ...base, history: [hist(1_400_000, 30)] }).findings).toHaveLength(0);
  });
  it("ignores near amounts older than 90 days", () => {
    expect(evaluateRisk({ ...base, history: [hist(1_450_000, 95)] }).findings).toHaveLength(0);
  });
  it("flags the same normalized invoice number", () => {
    expect(evaluateRisk({ ...base, history: [hist(99_900, 10, "mpg 88214")] }).findings.map((f) => f.ruleId)).toEqual(["R-03"]);
  });
});

describe("seeded historical data", () => {
  it("covers all 10 categories and at least 120 historical claims", () => {
    expect(new Set(plan.claims.map((c) => c.category)).size).toBe(10);
    expect(plan.claims.length - HERO_CLAIMS.length).toBeGreaterThanOrEqual(120);
  });
  it("clean historical claims raise no findings", () => {
    const unexpected = plan.claims
      .filter((c) => c.status !== "Pending" && !c.plannedAnomaly && !c.expected)
      .filter((c) => evaluateRisk(seedRiskInput(plan, c)).findings.length > 0)
      .map((c) => c.claimId);
    expect(unexpected).toEqual([]);
  });
});
