import { describe, expect, it } from "vitest";
import { IDENTITY, applyH, homographyFromQuad, mat3Inverse, mat3Mul, warpPerspective, type Pt, type Rgba } from "@/lib/bench/perspective";
import { deskTexture, photograph, projectedCorners } from "@/lib/bench/photo";

// Perspective primitives and the synthetic photo (Task 14 Part A, D-47).

const square: Pt[] = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];
const quad: Pt[] = [
  { x: 12, y: 8 },
  { x: 91, y: 20 },
  { x: 84, y: 95 },
  { x: 5, y: 77 },
];

/** A 100×100 test card: a dark 20×20 block at (30, 40) and a gradient elsewhere, fully opaque. */
function card(): Rgba {
  const data = new Uint8ClampedArray(100 * 100 * 4);
  for (let y = 0; y < 100; y++)
    for (let x = 0; x < 100; x++) {
      const o = (y * 100 + x) * 4;
      const dark = x >= 30 && x < 50 && y >= 40 && y < 60;
      const v = dark ? 20 : 120 + x;
      data.set([v, v, v, 255], o);
    }
  return { data, width: 100, height: 100 };
}

describe("homographyFromQuad", () => {
  it("maps each source corner onto its destination corner", () => {
    const H = homographyFromQuad(square, quad);
    square.forEach((p, i) => {
      const q = applyH(H, p);
      expect(q.x).toBeCloseTo(quad[i].x, 6);
      expect(q.y).toBeCloseTo(quad[i].y, 6);
    });
  });

  it("square → quad → square returns every point within 1 px (and far tighter)", () => {
    const there = homographyFromQuad(square, quad);
    const back = homographyFromQuad(quad, square);
    for (let y = 0; y <= 100; y += 10)
      for (let x = 0; x <= 100; x += 10) {
        const p = applyH(back, applyH(there, { x, y }));
        expect(Math.hypot(p.x - x, p.y - y)).toBeLessThan(1e-6);
      }
    const id = mat3Mul(back, there).map((v, _, a) => v / a[8]);
    id.forEach((v, i) => expect(v).toBeCloseTo(IDENTITY[i], 9));
  });

  it("rejects a degenerate quad", () => {
    expect(() => homographyFromQuad(square, [quad[0], quad[0], quad[1], quad[2]])).toThrow(/degenerate/);
  });
});

describe("mat3Inverse", () => {
  it("is the inverse of homographyFromQuad's result", () => {
    const H = homographyFromQuad(square, quad);
    // Homographies are defined up to scale: compare after normalising the product.
    mat3Mul(H, mat3Inverse(H)).forEach((v, i, a) => expect(v / a[8]).toBeCloseTo(IDENTITY[i], 9));
    expect(() => mat3Inverse([1, 2, 3, 2, 4, 6, 0, 0, 1])).toThrow(/singular/);
  });
});

describe("warpPerspective (bilinear)", () => {
  it("identity returns the image; square → quad → square returns the image within 1 px", () => {
    const img = card();
    expect(Buffer.from(warpPerspective(img, IDENTITY, { w: 100, h: 100 }).data)).toEqual(Buffer.from(img.data));
    // Sampling maps: to draw the card INTO the quad frame, sample quad-frame pixels from the card (quad → square).
    const toQuad = warpPerspective(img, homographyFromQuad(quad, square), { w: 100, h: 100 });
    const back = warpPerspective(toQuad, homographyFromQuad(square, quad), { w: 100, h: 100 });
    // The dark block's edges survive the round trip within 1 px: compare centroids and a pixel-wise check inside.
    const centroid = (im: Rgba) => {
      let sx = 0;
      let sy = 0;
      let n = 0;
      for (let y = 0; y < 100; y++)
        for (let x = 0; x < 100; x++) {
          const o = (y * 100 + x) * 4;
          if (im.data[o + 3] > 200 && im.data[o] < 70) {
            sx += x;
            sy += y;
            n++;
          }
        }
      return { x: sx / n, y: sy / n, n };
    };
    const a = centroid(img);
    const b = centroid(back);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(1);
    expect(Math.abs(a.n - b.n)).toBeLessThan(40); // area within a 1-px band of the 80-px perimeter
    let maxDiff = 0;
    for (let y = 15; y < 85; y++) for (let x = 15; x < 85; x++) maxDiff = Math.max(maxDiff, Math.abs(img.data[(y * 100 + x) * 4] - back.data[(y * 100 + x) * 4]));
    // Away from the block's 1-px edge band, interpolation error is small.
    expect(maxDiff).toBeLessThan(110);
  });

  it("outside the source is transparent", () => {
    const out = warpPerspective(card(), [1, 0, 500, 0, 1, 0, 0, 0, 1], { w: 10, h: 10 });
    expect(out.data[3]).toBe(0);
  });
});

describe("photograph", () => {
  const page = card();
  const desk = deskTexture(64, 64, 3);

  it("flat, centred, scale 1: the ground truth is the identity and the photo is the page", () => {
    const { image, groundTruth } = photograph(page, { pitchDeg: 0, yawDeg: 0, rollDeg: 0, offsetX: 0, offsetY: 0, background: desk, pageScale: 1 });
    groundTruth.forEach((v, i) => expect(v).toBeCloseTo(IDENTITY[i], 9));
    expect(image.data[(50 * 100 + 40) * 4]).toBe(20);
  });

  it("the ground truth maps the projected corners back onto the page corners", () => {
    const opts = { pitchDeg: 20, yawDeg: 15, rollDeg: 2, offsetX: 0.02, offsetY: -0.01, background: desk };
    const { groundTruth } = photograph(page, opts);
    const corners = projectedCorners({ w: 100, h: 100 }, opts);
    square.forEach((p, i) => {
      const q = applyH(groundTruth, corners[i]);
      expect(Math.hypot(q.x - p.x, q.y - p.y)).toBeLessThan(1e-6);
    });
    // Tilted: opposite edges are no longer parallel (it is a perspective, not an affine, view).
    const top = corners[1].x - corners[0].x;
    const bottom = corners[2].x - corners[3].x;
    expect(Math.abs(top - bottom)).toBeGreaterThan(1);
  });

  it("is deterministic, and the oracle rectification puts the dark block back where it was", () => {
    const opts = { pitchDeg: 20, yawDeg: 15, rollDeg: 2, offsetX: 0, offsetY: 0, background: desk, unevenLight: 0.3, seed: 9 };
    const a = photograph(page, opts);
    const b = photograph(page, opts);
    expect(Buffer.from(a.image.data)).toEqual(Buffer.from(b.image.data));
    const rect = warpPerspective(a.image, mat3Inverse(a.groundTruth), { w: 100, h: 100 });
    expect(rect.data[(50 * 100 + 40) * 4]).toBeLessThan(40);
    expect(rect.data[(20 * 100 + 80) * 4]).toBeGreaterThan(100);
  });
});

describe("capture-quality arms (Task 14 B2)", () => {
  it("are deterministic, and each does what it says", async () => {
    const { applyCapture, captureBytes, lowContrast, shadow } = await import("@/lib/bench/capture");
    const white: Rgba = { data: new Uint8ClampedArray(300 * 200 * 4).fill(255), width: 300, height: 200 };
    // Shadow: the left two thirds untouched, the right edge at ~40 %.
    const s = shadow(white);
    expect(s.data[(100 * 300 + 50) * 4]).toBe(255);
    expect(s.data[(100 * 300 + 299) * 4]).toBeLessThan(110);
    // Low contrast 0.6: white → 204, black → 51.
    expect(lowContrast(white, 0.6).data[0]).toBe(204);
    expect(lowContrast({ data: new Uint8ClampedArray([0, 0, 0, 255]), width: 1, height: 1 }, 0.6).data[0]).toBe(51);
    // Clutter: same document key → same bytes; a desk shows round the page.
    const a = applyCapture("clutter", white, "CLM-X");
    expect(Buffer.from(a.data)).toEqual(Buffer.from(applyCapture("clutter", white, "CLM-X").data));
    expect(a.data[0]).toBeLessThan(200);
    // Low contrast is handed to OCR as a quality-25 JPEG, everything else as PNG.
    expect(captureBytes("low-contrast", white, "CLM-X").mime).toBe("image/jpeg");
    expect(captureBytes("shadow", white, "CLM-X").mime).toBe("image/png");
  });

  it("the font option leaves the default render byte-identical (so cached baselines stay valid)", async () => {
    const { variantHtml, FONT_CSS } = await import("@/lib/bench/variants");
    const { buildSeedPlan } = await import("@/lib/seed/run");
    const doc = buildSeedPlan().claims[0].doc;
    expect(variantHtml(doc, "canonical", "label-left", "default")).toBe(variantHtml(doc, "canonical", "label-left"));
    expect(variantHtml(doc, "canonical", "label-left")).toContain("font-size:13px}\n</style>");
    expect(variantHtml(doc, "canonical", "label-left", "serif")).toContain(FONT_CSS.serif);
  });
});
