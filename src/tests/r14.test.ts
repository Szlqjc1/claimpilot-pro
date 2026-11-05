import { describe, expect, it } from "vitest";
import { buildSeedPlan, seedRiskInput } from "@/lib/seed/run";
import { evaluateRisk } from "@/lib/risk/score";
import { groundExtraction } from "@/lib/ai/grounding";
import type { RiskInput } from "@/lib/risk/types";

// R-14 re-pointed at OCR-layer signals (DECISIONS D-37): an ungrounded critical value, or OCR-layer confidence
// below 0.75 on a non-null critical value. A null / not_extracted value never fires it (B1).

const plan = buildSeedPlan();
const grounded = (input: RiskInput, claimId: string): RiskInput => ({
  ...input,
  extraction: { ...input.extraction, fieldChecks: groundExtraction(input.extraction, plan.fixtures.get(claimId)!.fixture.ocrText) },
});
const r14 = (input: RiskInput) => evaluateRisk(input).findings.find((f) => f.ruleId === "R-14") ?? null;

describe("B1: all 130 seeded claims, scored with grounding attached", () => {
  it("results are identical to scoring without grounding, R-14 fires on exactly the 4 lowOcr claims, never via not_extracted", () => {
    expect(plan.claims.length).toBe(130);
    const fired: string[] = [];
    for (const c of plan.claims) {
      const base = seedRiskInput(plan, c);
      const withChecks = grounded(base, c.claimId);
      expect(evaluateRisk(withChecks), c.claimId).toEqual(evaluateRisk(base));
      const f = r14(withChecks);
      if (f) {
        fired.push(c.claimId);
        expect(f.evidence.notInOcrText, c.claimId).toBeUndefined();
        for (const field of Object.keys(f.evidence)) expect(withChecks.extraction.fieldChecks?.[field], `${c.claimId}.${field}`).toBe("found");
      }
    }
    expect(fired.sort()).toEqual(plan.claims.filter((c) => c.plannedAnomaly === "lowOcr").map((c) => c.claimId).sort());
    expect(fired).toHaveLength(4);
  });

  it.each([
    ["CLM-2026-0142", 0, "Low", "AUTO_APPROVE"],
    ["CLM-2026-0143", 25, "Medium", "REVIEW"],
    ["CLM-2026-0144", 100, "High", "ESCALATE"],
    ["CLM-2026-0145", 60, "High", "ESCALATE"],
    ["CLM-2026-0146", 65, "High", "ESCALATE"],
    ["CLM-2026-0147", 50, "Medium", "REVIEW"],
    ["CLM-2026-0148", 65, "High", "ESCALATE"],
  ] as const)("hero %s stays %s · %s · %s with grounding attached", (id, score, level, decision) => {
    const c = plan.claims.find((x) => x.claimId === id)!;
    expect(evaluateRisk(grounded(seedRiskInput(plan, c), id))).toMatchObject({ score, riskLevel: level, decision });
  });
});

describe("R-14 triggers", () => {
  const c = plan.claims.find((x) => x.claimId === "CLM-2026-0142")!;
  const clean = seedRiskInput(plan, c);
  const conf = (over: Record<string, number>) => ({ ...clean.extraction.fieldConfidence, ...over });

  it("fires on a non-null critical value that is not in the OCR text, even at high OCR confidence", () => {
    const input = { ...clean, extraction: { ...clean.extraction, invoiceNumber: "MPG-88215", fieldChecks: { invoiceNumber: "not_found" as const } } };
    expect(r14(input)).toMatchObject({ points: 15, riskLevel: "Low", anomalyType: "Low OCR Confidence", evidence: { notInOcrText: ["invoiceNumber"] } });
  });

  it("still fires on OCR-layer confidence below 0.75 (threshold unchanged), capped at 30 points", () => {
    const input = { ...clean, extraction: { ...clean.extraction, fieldConfidence: conf({ total: 0.68, invoiceNumber: 0.71, vendorName: 0.7 }) } };
    expect(r14(input)).toMatchObject({ points: 30, evidence: { total: 0.68, invoiceNumber: 0.71, vendorName: 0.7 } });
  });

  it("never fires on a null value, whatever its confidence (B1: poNumber absent at 0.50)", () => {
    const input = { ...clean, extraction: { ...clean.extraction, poNumber: null, fieldConfidence: conf({ poNumber: 0.5 }) } };
    expect(r14(input)).toBeNull();
  });

  it("never fires on a field grounding marked not_extracted", () => {
    const input = { ...clean, extraction: { ...clean.extraction, fieldConfidence: conf({ poNumber: 0.5 }), fieldChecks: { poNumber: "not_extracted" as const } } };
    expect(r14(input)).toBeNull();
  });
});
