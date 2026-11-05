import { describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import { binarizeGlobal, deskewAndScale, estimateSkew, illuminationSpread, otsuThreshold, preprocess, GRADIENT_LIMIT, type RgbaImage } from "@/lib/ai/preprocess";
import { encodePgm, prepareForOcr, wordsFromBlocks } from "@/lib/ai/ocr-prep";

// OCR clean-up (Task 7b Part B). Synthetic images only: text lines are dashed horizontal bands.

/** A "page" of dashed text lines rotated clockwise by `deg`, with an optional left→right illumination gradient. */
function page(deg: number, opts: { width?: number; height?: number; gradient?: number; ink?: number } = {}): RgbaImage {
  const W = opts.width ?? 480;
  const H = opts.height ?? 360;
  const data = new Uint8Array(W * H * 4);
  const r = (deg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      // Rotate back by −deg to find where this pixel sits on the straight page.
      const dx = x - W / 2;
      const dy = y - H / 2;
      const ux = dx * cos + dy * sin + W / 2;
      const uy = -dx * sin + dy * cos + H / 2;
      const onLine = uy > 40 && uy < H - 40 && Math.floor(uy) % 24 < 6 && ux > 40 && ux < W - 40 && Math.floor(ux) % 14 < 10;
      const paper = 255 - (opts.gradient ?? 0) * (x / W);
      const v = onLine ? Math.max(0, paper - (opts.ink ?? 200)) : paper;
      const i = (y * W + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = Math.round(v);
      data[i + 3] = 255;
    }
  return { data, width: W, height: H };
}
const gray = (img: RgbaImage) => ({ data: Uint8Array.from({ length: img.width * img.height }, (_, i) => img.data[i * 4]), width: img.width, height: img.height });
const pngOf = (img: RgbaImage) => PNG.sync.write(Object.assign(new PNG({ width: img.width, height: img.height }), { data: Buffer.from(img.data) }));

describe("skew estimator", () => {
  it.each([0, 2, -1.5, 3, -3])("recovers a %s° rotation to within one step", (deg) => {
    expect(Math.abs(estimateSkew(gray(page(deg))) - deg)).toBeLessThanOrEqual(0.5);
  });

  it("deskewing a rotated page makes it straight again (round trip)", () => {
    const rotated = gray(page(2));
    const straight = deskewAndScale(rotated, estimateSkew(rotated), 1);
    expect(Math.abs(estimateSkew(straight))).toBeLessThanOrEqual(0.5);
  });

  it("returns 0 for a blank page", () => {
    expect(estimateSkew({ data: new Uint8Array(200 * 100).fill(255), width: 200, height: 100 })).toBe(0);
  });
});

describe("binarisation", () => {
  it("Otsu splits a bimodal image between the two modes", () => {
    const values = Uint8Array.from({ length: 1000 }, (_, i) => (i % 5 === 0 ? 40 + (i % 7) : 220 - (i % 9)));
    const t = otsuThreshold(values);
    // Pixels ≤ t are ink: t must sit at or above the dark mode's top (46) and below the light mode's bottom (212).
    expect(t).toBeGreaterThanOrEqual(46);
    expect(t).toBeLessThan(212);
    expect(binarizeGlobal({ data: values, width: 1000, height: 1 }, t).data.filter((v) => v === 0).length).toBe(200);
  });

  it("a clean page uses one global Otsu threshold", () => {
    const out = preprocess(page(0));
    expect(out.method).toBe("otsu");
    expect(out.width).toBe(960); // 2× upscale
    expect(out.inkRatio).toBeGreaterThan(0.05);
    expect(out.inkRatio).toBeLessThan(0.4);
  });

  it("a strong illumination gradient falls back to the 32 px tiled threshold, which keeps the dark side readable", () => {
    const shaded = page(0, { gradient: 150, ink: 60 });
    expect(illuminationSpread(gray(shaded))).toBeGreaterThan(GRADIENT_LIMIT);
    const out = preprocess(shaded);
    expect(out.method).toBe("tiled");
    // A single global threshold would turn the dark half of the page black.
    const g = gray(shaded);
    expect(binarizeGlobal(g, otsuThreshold(g.data)).data.filter((v) => v === 0).length / g.data.length).toBeGreaterThan(0.3);
    expect(out.inkRatio).toBeLessThan(0.3);
    expect(out.inkRatio).toBeGreaterThan(0.02);
  });

  it("the grayscale option skips thresholding but still deskews and upscales", () => {
    const out = preprocess(page(1.5), { binarize: false });
    expect(out.method).toBe("gray");
    expect(out.width).toBe(960);
    expect(out.skewDeg).toBeCloseTo(1.5, 0);
    expect(new Set(out.data).size).toBeGreaterThan(2);
  });
});

describe("prepareForOcr guard (an upload never fails because of preprocessing)", () => {
  it("a normal page is preprocessed and encoded as PGM", () => {
    const { image, prep } = prepareForOcr(pngOf(page(1)), "image/png", { mode: "binary", psm: "3" });
    expect(prep).toMatchObject({ preprocessed: true, method: "otsu", psm: "3" });
    expect(image.subarray(0, 2).toString("ascii")).toBe("P5");
  });

  it("a degenerate result (< 1 % ink) falls back to the original with a warning", () => {
    const blank = pngOf({ data: new Uint8Array(100 * 80 * 4).fill(255), width: 100, height: 80 });
    const { image, prep } = prepareForOcr(blank, "image/png", { mode: "binary", psm: "3" });
    expect(prep.preprocessed).toBe(false);
    expect(prep.warning).toMatch(/degenerate image/);
    expect(image).toBe(blank);
  });

  it("an undecodable image falls back to the original with a warning instead of throwing", () => {
    const junk = Buffer.from("not an image");
    const { image, prep } = prepareForOcr(junk, "image/png", { mode: "gray", psm: "default" });
    expect(prep.preprocessed).toBe(false);
    expect(prep.warning).toMatch(/Preprocessing failed/);
    expect(image).toBe(junk);
  });
});

describe("OCR word capture", () => {
  it("flattens tesseract.js blocks into words with normalised boxes and 0–1 confidence", () => {
    const blocks = [{ paragraphs: [{ lines: [{ words: [{ text: "PO", confidence: 91.4, bbox: { x0: 100, y0: 50, x1: 140, y1: 70 } }, { text: " ", confidence: 0, bbox: { x0: 0, y0: 0, x1: 1, y1: 1 } }, { text: "4500871", confidence: 88, bbox: { x0: 150, y0: 50, x1: 260, y1: 70 } }] }] }] }];
    const words = wordsFromBlocks(blocks, 1000, 500);
    expect(words).toEqual([
      { text: "PO", confidence: 0.91, bbox: { field: "word", x: 0.1, y: 0.1, w: 0.04, h: 0.04, page: 1 } },
      { text: "4500871", confidence: 0.88, bbox: { field: "word", x: 0.15, y: 0.1, w: 0.11, h: 0.04, page: 1 } },
    ]);
    expect(wordsFromBlocks(null, 10, 10)).toEqual([]);
  });

  it("PGM encoding has the binary header Leptonica expects", () => {
    const pgm = encodePgm({ data: new Uint8Array([0, 255, 0, 255]), width: 2, height: 2 });
    expect(pgm.toString("ascii", 0, 11)).toBe("P5\n2 2\n255\n");
    expect([...pgm.subarray(11)]).toEqual([0, 255, 0, 255]);
  });
});
