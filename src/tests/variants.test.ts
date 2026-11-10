import { describe, expect, it } from "vitest";
import { buildSeedPlan } from "@/lib/seed/run";
import { BENCH_FIELDS, LABEL_SETS, LABEL_VARIANTS, LAYOUT_VARIANTS, docHasError, fieldOutcome, summarise, variantHtml, type DocResult } from "@/lib/bench/variants";
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
