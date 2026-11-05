import { describe, expect, it } from "vitest";
import { binomialCdf, lowerBound, requiredN, upperBound } from "@/lib/bench/stats";
import { degradationFor, hashSeed, mulberry32 } from "@/lib/bench/prng";

// Helpers behind docs/GROUNDING_BENCH.md. The benchmark itself is a script (too slow for CI); these are not.

describe("interval helpers", () => {
  it("zero failures reduce to 1 − α^(1/n)", () => {
    expect(upperBound(0, 600)).toBeCloseTo(1 - 0.05 ** (1 / 600), 10);
    expect(upperBound(0, 600)).toBeLessThan(0.005);
    expect(lowerBound(300, 300)).toBeCloseTo(0.05 ** (1 / 300), 10);
    expect(lowerBound(300, 300)).toBeGreaterThan(0.99);
  });

  it("required n matches the agreed table (ln 0.05 / ln target)", () => {
    expect(requiredN(0.95)).toBe(59); // 58.4 → 59 (the brief rounds to 60)
    expect(requiredN(0.98)).toBe(149);
    expect(requiredN(0.99)).toBe(299); // 298.07 → 299: 298 clean trials give a lower bound just under 99 %
    expect(requiredN(0.995)).toBe(598);
    expect(lowerBound(298, 298)).toBeLessThan(0.99);
    expect(lowerBound(299, 299)).toBeGreaterThanOrEqual(0.99);
  });

  it("bounds bracket the point estimate and agree with the binomial CDF", () => {
    const [k, n] = [12, 600];
    const u = upperBound(k, n);
    expect(u).toBeGreaterThan(k / n);
    expect(binomialCdf(k, n, u)).toBeCloseTo(0.05, 6);
    const l = lowerBound(290, 300);
    expect(l).toBeLessThan(290 / 300);
    expect(1 - binomialCdf(289, 300, l)).toBeCloseTo(0.05, 6);
  });

  it("degenerate inputs are safe", () => {
    expect(upperBound(0, 0)).toBe(1);
    expect(lowerBound(0, 0)).toBe(0);
    expect(upperBound(5, 5)).toBe(1);
  });
});

describe("degradation PRNG", () => {
  it("same seed ⇒ same sequence and parameters; different seed ⇒ different", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(degradationFor(hashSeed(20261105, "CLM-2026-0144", 3))).toEqual(degradationFor(hashSeed(20261105, "CLM-2026-0144", 3)));
    expect(degradationFor(hashSeed(20261105, "CLM-2026-0144", 3))).not.toEqual(degradationFor(hashSeed(20261105, "CLM-2026-0144", 4)));
  });

  it("parameters stay inside the agreed ranges over many seeds", () => {
    for (let i = 0; i < 2000; i++) {
      const d = degradationFor(hashSeed("range", i));
      expect(d.blurSigma).toBeGreaterThanOrEqual(0.5);
      expect(d.blurSigma).toBeLessThanOrEqual(2);
      expect(Math.abs(d.rotateDeg)).toBeLessThanOrEqual(2);
      expect(d.jpegQuality).toBeGreaterThanOrEqual(40);
      expect(d.jpegQuality).toBeLessThanOrEqual(70);
      expect(d.scale).toBeGreaterThanOrEqual(0.5);
      expect(d.scale).toBeLessThanOrEqual(0.7);
      expect(d.contrast).toBeGreaterThanOrEqual(0.85);
      expect(d.contrast).toBeLessThanOrEqual(1.15);
    }
  });

  it("mulberry32 output is roughly uniform", () => {
    const r = mulberry32(7);
    const xs = Array.from({ length: 20000 }, r);
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
    expect(mean).toBeGreaterThan(0.49);
    expect(mean).toBeLessThan(0.51);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThan(1);
  });
});

describe("mutation corpus", () => {
  it("absent errors are not in the text, confusable errors are, format changes keep the value and are found", async () => {
    const { buildSeedPlan } = await import("@/lib/seed/run");
    const { mutationsFor } = await import("@/lib/bench/mutate");
    const { checkField } = await import("@/lib/ai/grounding");
    const plan = buildSeedPlan();
    const kinds = { absent: 0, confusable: 0, format: 0 };
    for (const id of ["CLM-2026-0142", "CLM-2026-0144", "CLM-2026-0147"]) {
      const { extraction, ocrText } = plan.fixtures.get(id)!.fixture;
      for (const m of mutationsFor(extraction, ocrText)) {
        kinds[m.kind]++;
        const check = checkField(m.field, m.extraction, m.ocrText);
        if (m.kind === "absent") expect(check, `${id} ${m.field}`).toBe("not_found");
        else expect(check, `${id} ${m.field} ${m.kind}`).toBe("found");
        expect(m.isError).toBe(m.kind !== "format");
        // deterministic: building the corpus twice gives the same mutation
        expect(mutationsFor(extraction, ocrText).find((x) => x.field === m.field && x.kind === m.kind)?.description).toBe(m.description);
      }
    }
    expect(kinds.absent).toBeGreaterThan(0);
    expect(kinds.confusable).toBeGreaterThan(0);
    expect(kinds.format).toBeGreaterThan(0);
  });
});
