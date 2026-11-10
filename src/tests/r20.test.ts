import { describe, expect, it } from "vitest";
import { buildSeedPlan, seedRiskInput } from "@/lib/seed/run";
import { evaluateRisk } from "@/lib/risk/score";
import { exposureFor } from "@/lib/risk/exposure";
import type { RiskInput } from "@/lib/risk/types";

// R-20 "Invoice Does Not Match Claim" (DECISIONS D-46): the extraction against the claim's own record.

const plan = buildSeedPlan();
const inputFor = (id: string) => seedRiskInput(plan, plan.claims.find((c) => c.claimId === id)!);
const base = inputFor("CLM-2026-0142"); // $14,500, clean, has a PO
const r20 = (input: RiskInput) => evaluateRisk(input).findings.find((f) => f.ruleId === "R-20") ?? null;
const withExtraction = (over: Partial<RiskInput["extraction"]>, input: RiskInput = base): RiskInput => ({ ...input, extraction: { ...input.extraction, ...over } });

describe("R-20 fires on each field", () => {
  it("vendor: a name cut by a line wrap (the benchmark's failure) → Medium 25", () => {
    const name = base.claim.vendorName.split(" ")[0]; // e.g. "Midwest" for "Midwest Proving Grounds, LLC"
    const f = r20(withExtraction({ vendor: { ...base.extraction.vendor, name } }))!;
    expect(f).toMatchObject({ points: 25, riskLevel: "Medium", anomalyType: "Invoice Does Not Match Claim", evidence: { vendor: { invoice: name, claim: base.claim.vendorName } } });
    expect(f.message).toBe(`Invoice does not match the claim: vendor '${name}' vs ${base.claim.vendorName}. Verify the invoice belongs to this claim.`);
    expect(evaluateRisk(withExtraction({ vendor: { ...base.extraction.vendor, name } })).decision).toBe("REVIEW");
  });

  it("invoice #", () => {
    expect(r20(withExtraction({ invoiceNumber: `${base.claim.invoiceNumber}9` }))?.evidence).toHaveProperty("invoiceNumber");
  });

  it("PO: an OCR digit insertion, and a PO the claim does not reference", () => {
    expect(r20(withExtraction({ poNumber: `${base.claim.poNumber}0` }))).toMatchObject({ points: 25, evidence: { poNumber: { claim: base.claim.poNumber } } });
    const noPo = { ...base, claim: { ...base.claim, poNumber: null } };
    expect(r20(withExtraction({}, noPo))!.message).toContain("which the claim does not reference");
  });

  it("total: High 40, exposure = the difference; one finding lists every mismatch", () => {
    const input = withExtraction({ total: base.extraction.total + 100, invoiceNumber: "OTHER-1" });
    const f = r20(input)!;
    expect(f).toMatchObject({ points: 40, riskLevel: "High", evidence: { total: { differenceCents: 10_000 } } });
    expect(Object.keys(f.evidence).sort()).toEqual(["invoiceNumber", "total"]);
    expect(exposureFor(f, input)).toBe(10_000);
    expect(exposureFor(r20(withExtraction({ invoiceNumber: "OTHER-1" }))!, base)).toBeNull();
    expect(evaluateRisk(input).decision).toBe("ESCALATE");
  });
});

describe("R-20 does not fire", () => {
  it("on normalised equivalents", () => {
    const e = base.extraction;
    const same = withExtraction({
      vendor: { ...e.vendor, name: `${base.claim.vendorName.toUpperCase()}, LLC` },
      invoiceNumber: base.claim.invoiceNumber!.toLowerCase().replace(/-/g, " "),
      poNumber: ` ${base.claim.poNumber} `,
      total: base.claim.amountCents / 100 + 0.001,
    });
    expect(r20(same)).toBeNull();
  });

  it("on a missing value on either side", () => {
    expect(r20(withExtraction({ vendor: { ...base.extraction.vendor, name: null }, invoiceNumber: null, poNumber: null }))).toBeNull();
    expect(r20({ ...base, claim: { ...base.claim, invoiceNumber: null } })).toBeNull();
  });

  it("on any of the 130 seeded claims, so every seeded result and the heroes are unchanged", () => {
    expect(plan.claims).toHaveLength(130);
    for (const c of plan.claims) expect(r20(seedRiskInput(plan, c)), c.claimId).toBeNull();
    expect(evaluateRisk(inputFor("CLM-2026-0142"))).toMatchObject({ score: 0, decision: "AUTO_APPROVE" });
    expect(evaluateRisk(inputFor("CLM-2026-0144"))).toMatchObject({ score: 100, decision: "ESCALATE" });
    expect(evaluateRisk(inputFor("CLM-2026-0146"))).toMatchObject({ score: 65, decision: "ESCALATE" });
    expect(evaluateRisk(inputFor("CLM-2026-0147"))).toMatchObject({ score: 50, decision: "REVIEW" });
  });
});
