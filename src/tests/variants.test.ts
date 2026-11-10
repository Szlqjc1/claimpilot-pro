import { describe, expect, it } from "vitest";
import { buildSeedPlan } from "@/lib/seed/run";
import { BENCH_FIELDS, LABEL_SETS, LABEL_VARIANTS, LAYOUT_VARIANTS, docHasError, fieldOutcome, recoveryDecision, summarise, variantHtml, type DocResult } from "@/lib/bench/variants";
import { formatUsd } from "@/lib/domain/money";
import { totalCents } from "@/lib/receipts/invoice";

// Variant benchmark, pure parts (Task 13 Part B, D-45). The live run is scripts/extraction-variants.ts.

const plan = buildSeedPlan();
const claim = plan.claims.find((c) => c.claimId === "CLM-2026-0142")!;
const truth = plan.fixtures.get("CLM-2026-0142")!.fixture.extraction;

describe("variantHtml", () => {
  it("every label × layout carries the same values; only the labels change", () => {
    for (const label of LABEL_VARIANTS) {
      for (const layout of LAYOUT_VARIANTS) {
        const html = variantHtml(claim.doc, label, layout);
        for (const v of [claim.doc.invoiceNumber, claim.doc.invoiceDate, formatUsd(totalCents(claim.doc))]) expect(html, `${label}/${layout}`).toContain(v);
        expect(html).toContain(LABEL_SETS[label].invoiceNumber);
        expect(html).toContain(LABEL_SETS[label].total.replace(/&/g, "&amp;"));
      }
    }
  });

  it("the three layouts differ, the five label sets differ", () => {
    expect(new Set(LAYOUT_VARIANTS.map((l) => variantHtml(claim.doc, "canonical", l))).size).toBe(3);
    expect(new Set(LABEL_VARIANTS.map((l) => variantHtml(claim.doc, l, "label-left"))).size).toBe(5);
    expect(variantHtml(claim.doc, "chinese", "label-left")).toContain("发票号");
    expect(variantHtml(claim.doc, "german", "label-left")).toContain("Rechnungsnummer");
  });
});

describe("fieldOutcome", () => {
  it("matches with the engine's own normalisation", () => {
    const got = { ...truth, vendor: { ...truth.vendor, name: `${truth.vendor.name!.toUpperCase()}, LLC` }, invoiceNumber: truth.invoiceNumber!.toLowerCase().replace(/-/g, " ") };
    expect(fieldOutcome("vendorName", got, truth)).toBe("correct");
    expect(fieldOutcome("invoiceNumber", got, truth)).toBe("correct");
    expect(fieldOutcome("total", { ...truth, total: truth.total + 0.001 }, truth)).toBe("correct");
  });

  it("wrong, missed and a correct null are told apart", () => {
    expect(fieldOutcome("total", { ...truth, total: truth.total + 1 }, truth)).toBe("wrong");
    expect(fieldOutcome("invoiceDate", { ...truth, invoiceDate: null }, truth)).toBe("missed");
    expect(fieldOutcome("poNumber", { ...truth, poNumber: null }, { ...truth, poNumber: null })).toBe("correct-null");
    expect(fieldOutcome("poNumber", { ...truth, poNumber: "4500000001" }, { ...truth, poNumber: null })).toBe("wrong");
  });
});

describe("summarise: three columns, never one", () => {
  const ok = Object.fromEntries(BENCH_FIELDS.map((f) => [f, "correct"])) as DocResult["outcomes"];
  const row = (over: Partial<DocResult>): DocResult => ({ axis: "label", variant: "german", claimId: "X", outcomes: ok, escalated: false, cleared: true, ...over });
  const rows: DocResult[] = [
    row({}),
    row({ outcomes: { ...ok, total: "wrong" }, cleared: true }), // a wrong field that slipped through
    row({ outcomes: { ...ok, invoiceNumber: "missed" }, escalated: true, cleared: false }),
    row({ outcomes: { ...ok, poNumber: "correct-null" }, cleared: true }),
    row({ variant: "canonical" }),
  ];

  it("accuracy over returned values, escalation over documents, error over cleared documents", () => {
    const s = summarise(rows, "label", "german");
    expect(s).toMatchObject({ docs: 4, returned: 18, correct: 17, escalated: 1, cleared: 3, clearedWithError: 1 });
    expect(s.accuracy).toBeCloseTo(17 / 18);
    expect(s.escalationRate).toBe(0.25);
    expect(s.errorInCleared).toBeCloseTo(1 / 3);
    expect(docHasError(rows[2])).toBe(true);
    expect(docHasError(rows[3])).toBe(false);
  });
});

describe("recoveryDecision: the pre-registered perspective rule (docs/PERSPECTIVE.md)", () => {
  it("≥ 70 % build, ≤ 30 % do not build, between spike", () => {
    expect(recoveryDecision({ a0: 0, a1: 10, a2: 2 }, 20)).toEqual({ gap: 10, recovered: 8, recoveryPct: 0.8, verdict: "build" });
    expect(recoveryDecision({ a0: 0, a1: 10, a2: 3 }, 20).verdict).toBe("build"); // exactly 70 %
    expect(recoveryDecision({ a0: 0, a1: 10, a2: 7 }, 20).verdict).toBe("do-not-build"); // exactly 30 %
    expect(recoveryDecision({ a0: 0, a1: 10, a2: 5 }, 20).verdict).toBe("spike");
  });

  it("negative recovery (rectifying made it worse) does not build; a gap of one document is no gap", () => {
    expect(recoveryDecision({ a0: 1, a1: 6, a2: 8 }, 20).verdict).toBe("do-not-build");
    expect(recoveryDecision({ a0: 1, a1: 2, a2: 2 }, 20)).toMatchObject({ recoveryPct: null, verdict: "no-measurable-gap" });
    expect(recoveryDecision({ a0: 0, a1: 0, a2: 0 }, 20).verdict).toBe("no-measurable-gap");
  });
});
