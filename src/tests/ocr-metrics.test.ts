import { describe, expect, it } from "vitest";
import { normalizeIllumination, type GrayImage } from "@/lib/ai/preprocess";
import { buildSeedPlan, seedRiskInput } from "@/lib/seed/run";
import { cer, criticalHits, editDistance, knownGoodRisk } from "@/lib/bench/ocr-metrics";
import { sizeCss, variantHtml, variantTranscript } from "@/lib/bench/variants";

// Illumination normalisation (D-52) and the model-free OCR metrics (D-52, D-53).

/** 200×100 page: paper 240, a 20×10 ink block at (30, 40) and another at (150, 40). */
function page(): GrayImage {
  const data = new Uint8Array(200 * 100).fill(240);
  for (let y = 40; y < 50; y++) for (let x = 0; x < 20; x++) {
    data[y * 200 + 30 + x] = 30;
    data[y * 200 + 150 + x] = 30;
  }
  return { data, width: 200, height: 100 };
}

describe("normalizeIllumination", () => {
  it("leaves a uniformly lit page essentially unchanged (paper → white, ink stays dark)", () => {
    const out = normalizeIllumination(page());
    expect(out.data[10 * 200 + 10]).toBe(255);
    expect(out.data[45 * 200 + 35]).toBeLessThan(40);
  });

  it("flattens a soft shadow: shaded paper becomes white again and shaded ink keeps its contrast", () => {
    // 600×100 page, paper 240, ink blocks at x=30 (lit) and x=500 (shaded); a shadow ramps 1.0 → 0.4 over x 200–320
    // (a soft penumbra, like the benchmark's), then stays at 0.4.
    const w = 600;
    const data = new Uint8Array(w * 100).fill(240);
    for (let y = 40; y < 50; y++) for (let x = 0; x < 20; x++) {
      data[y * w + 30 + x] = 30;
      data[y * w + 500 + x] = 30;
    }
    for (let y = 0; y < 100; y++)
      for (let x = 0; x < w; x++) {
        const t = Math.min(1, Math.max(0, (x - 200) / 120));
        data[y * w + x] = Math.round(data[y * w + x] * (1 - 0.6 * t));
      }
    // Before: the shaded paper (96) sits where a global threshold between ink and lit paper would call it ink.
    expect(data[10 * w + 560]).toBe(96);
    const out = normalizeIllumination({ data, width: w, height: 100 });
    expect(out.data[10 * w + 560]).toBeGreaterThan(230); // shaded paper → white
    expect(out.data[45 * w + 505]).toBeLessThan(60); // shaded ink → still ink
    expect(out.data[45 * w + 35]).toBeLessThan(40); // lit ink untouched
  });

  it("known limit: right at a HARD shadow edge the paper estimate lags by up to ~1.5 blocks", () => {
    const shaded = page();
    for (let y = 0; y < 100; y++) for (let x = 130; x < 200; x++) shaded.data[y * 200 + x] = Math.round(shaded.data[y * 200 + x] * 0.4);
    const out = normalizeIllumination(shaded);
    // Brighter than before (96), but not yet white: the 96 px window still sees lit paper across the edge.
    expect(out.data[10 * 200 + 180]).toBeGreaterThan(96);
    expect(out.data[10 * 200 + 180]).toBeLessThan(230);
  });
});

describe("OCR metrics", () => {
  it("editDistance and order-insensitive CER", () => {
    expect(editDistance("kitten", "sitting")).toBe(3);
    expect(cer("Invoice No. A-1\nTotal $5.00", "Total $5.00 Invoice No. A-1")).toBe(0); // reading order does not count
    expect(cer("Invoice No. A-7", "Invoice No. A-1")).toBeCloseTo(1 / 15);
    expect(cer("", "abc")).toBe(1); // everything dropped
  });

  const plan = buildSeedPlan();
  const c = plan.claims.find((x) => x.claimId === "CLM-2026-0142")!;
  const input = seedRiskInput(plan, c);
  const text = plan.fixtures.get(c.claimId)!.fixture.ocrText;

  it("critical hits use the grounding matchers; known-good risk notices what the OCR text lacks", () => {
    expect(criticalHits(input, text)).toEqual({ hits: 5, known: 5 });
    expect(knownGoodRisk(input, text, 0.95)).toMatchObject({ r14: false, r19: false, decision: "AUTO_APPROVE" });
    // Drop the header lines: the known-good values are no longer verifiable → R-14, review.
    const lost = text.split("\n").filter((l) => !/^(Invoice No|Invoice Date|PO Number)/.test(l)).join("\n");
    expect(criticalHits(input, lost).hits).toBeLessThan(5);
    expect(knownGoodRisk(input, lost, 0.95)).toMatchObject({ r14: true, decision: "REVIEW" });
  });

  it("the transcript holds every value the renderer draws, and sizeCss leaves the default render alone", () => {
    const t = variantTranscript(c.doc, "canonical");
    for (const v of [c.doc.invoiceNumber, c.doc.invoiceDate, c.doc.vendor.name]) expect(t).toContain(v);
    expect(variantHtml(c.doc, "canonical", "label-left", "default", "")).toBe(variantHtml(c.doc, "canonical", "label-left"));
    expect(sizeCss(27.78, 827)).toContain("body{font-size:27.78px !important}");
  });
});
