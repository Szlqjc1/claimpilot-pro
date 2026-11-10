import { describe, expect, it } from "vitest";
import { detectPageCorners } from "@/lib/ai/corners";
import { applyH, mat3Inverse, type Rgba } from "@/lib/ai/perspective";
import { FLAT_MAX_CORNER_OFFSET, FLAT_MIN_AREA, prepareForOcr, rectifyForOcr, rectifyHint, wordsToOriginal, type OcrPrep, type OcrWord } from "@/lib/ai/ocr-prep";
import { encodePng, photoOptions } from "@/lib/bench/capture";
import { photograph, projectedCorners } from "@/lib/bench/photo";
import { readEnv } from "@/lib/env";

// Page rectification on the upload path (D-50): flat-scan guard, full-frame fallbacks, word boxes mapped back.

const W = 680;
const H = 880;

function blank(w: number, h: number, v = 255): Rgba {
  const data = new Uint8ClampedArray(w * h * 4).fill(v);
  for (let o = 3; o < data.length; o += 4) data[o] = 255;
  return { data, width: w, height: h };
}
function fillRect(img: Rgba, x0: number, y0: number, x1: number, y1: number, v: number) {
  for (let y = Math.round(y0); y < Math.round(y1); y++) for (let x = Math.round(x0); x < Math.round(x1); x++) img.data.fill(v, (y * img.width + x) * 4, (y * img.width + x) * 4 + 3);
}
/** A page with a header block and rows of "text" inside the margins. */
function textPage(): Rgba {
  const img = blank(W, H);
  fillRect(img, 60, 50, 330, 80, 30); // header
  for (let y = 120; y < H - 70; y += 22) for (let x = 60; x < W - 60; x += 47) fillRect(img, x, y, x + 30, y + 8, 25);
  return img;
}
/**
 * A full-frame flat scan whose invoice table is ruled (4 px border) and covers most of the page, so the table's white
 * interior is a bigger bright region than the page margins around it. The header sits above the table.
 */
function scanWithBigTable(): Rgba {
  const img = blank(W, H);
  fillRect(img, 30, 20, 320, 60, 30); // header: what must never be cropped
  const [x0, y0, x1, y1] = [24, 110, W - 24, H - 22];
  fillRect(img, x0, y0, x1, y0 + 4, 20);
  fillRect(img, x0, y1 - 4, x1, y1, 20);
  fillRect(img, x0, y0, x0 + 4, y1, 20);
  fillRect(img, x1 - 4, y0, x1, y1, 20);
  for (let y = y0 + 30; y < y1 - 30; y += 40) for (let x = x0 + 30; x < x1 - 60; x += 70) fillRect(img, x, y, x + 40, y + 8, 25);
  return img;
}
/** A near-white table top (≈ 232, faint noise) under a white page. */
function whiteTable(): Rgba {
  const img = blank(256, 256, 232);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 228 + ((i * 2654435761) >>> 28);
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
  }
  return img;
}

describe("rectifyForOcr: when the upload is warped flat, and when OCR reads the full frame", () => {
  it("a tilted photo on a desk is rectified, with the geometry recorded", () => {
    const opts = photoOptions({ pitchDeg: 20, yawDeg: 15 }, "CLM-U1");
    const { image } = photograph(textPage(), opts);
    const { image: flat, rectify } = rectifyForOcr(image, true);
    expect(rectify).toMatchObject({ scope: "page", reason: "rectified" });
    expect(flat).not.toBe(image);
    expect(flat.width).toBe(rectify.size!.w);
    // page → photo maps the page's corners onto the true projected corners.
    const truth = projectedCorners({ w: W, h: H }, opts);
    const pageCorners = [
      { x: 0, y: 0 },
      { x: rectify.size!.w, y: 0 },
      { x: rectify.size!.w, y: rectify.size!.h },
      { x: 0, y: rectify.size!.h },
    ];
    pageCorners.forEach((p, i) => {
      const q = applyH(rectify.pageToPhoto!, p);
      expect(Math.hypot(q.x - truth[i].x, q.y - truth[i].y)).toBeLessThan(1);
    });
    expect(rectify.areaFraction!).toBeLessThan(FLAT_MIN_AREA);
  });

  it("flat-scan guard: a page that fills the frame is not resampled", () => {
    const scan = textPage();
    const { image, rectify } = rectifyForOcr(scan, true);
    expect(rectify).toMatchObject({ scope: "full-frame", reason: "flat-scan", pageToPhoto: null, size: null });
    expect(rectify.areaFraction!).toBeGreaterThan(FLAT_MIN_AREA);
    expect(rectify.maxCornerOffset!).toBeLessThan(FLAT_MAX_CORNER_OFFSET);
    expect(image).toBe(scan); // the very same pixels go to OCR
  });

  it("a ruled table that dominates a flat scan is never taken for the page (the header is not cropped)", () => {
    const scan = scanWithBigTable();
    const found = detectPageCorners(scan);
    // Either no page or the frame itself: never the table's interior.
    if (found) expect(Math.min(...found.corners.map((p) => p.y))).toBeLessThan(10);
    const { image, rectify } = rectifyForOcr(scan, true);
    expect(rectify.scope).toBe("full-frame");
    expect(image).toBe(scan);
  });

  it("a blank sheet on a white table: no page found, full frame", () => {
    const { image } = photograph(blank(W, H), { ...photoOptions({ pitchDeg: 10, yawDeg: 10 }, "CLM-U2"), background: whiteTable(), unevenLight: 0.1 });
    const { image: out, rectify } = rectifyForOcr(image, true);
    expect(rectify).toMatchObject({ scope: "full-frame", reason: "no-page" });
    expect(out).toBe(image);
  });

  it("a printed page on a white table: paper and table read as one bright frame, so the flat-scan guard keeps it whole", () => {
    // Otsu separates ink from paper-plus-table, so the "page" is the frame; nothing is cropped or resampled.
    const { image } = photograph(textPage(), { ...photoOptions({ pitchDeg: 10, yawDeg: 10 }, "CLM-U2"), background: whiteTable(), unevenLight: 0.1 });
    const { image: out, rectify } = rectifyForOcr(image, true);
    expect(rectify.scope).toBe("full-frame");
    expect(["no-page", "flat-scan"]).toContain(rectify.reason);
    expect(out).toBe(image);
  });

  it("switched off: full frame, reason disabled, nothing detected", () => {
    const { image } = photograph(textPage(), photoOptions({ pitchDeg: 20, yawDeg: 15 }, "CLM-U3"));
    const { image: out, rectify } = rectifyForOcr(image, false);
    expect(rectify).toMatchObject({ scope: "full-frame", reason: "disabled", corners: null });
    expect(out).toBe(image);
  });
});

describe("prepareForOcr with rectification", () => {
  const photo = photograph(textPage(), photoOptions({ pitchDeg: 20, yawDeg: 15 }, "CLM-U4")).image;
  const png = encodePng(photo);

  it("records the rectification on the prep; without the option (benchmarks) there is no rectify step", () => {
    const on = prepareForOcr(png, "image/png", { mode: "gray", psm: "3", rectify: true });
    expect(on.prep.preprocessed).toBe(true);
    expect(on.prep.rectify).toMatchObject({ scope: "page", reason: "rectified" });
    const off = prepareForOcr(png, "image/png", { mode: "gray", psm: "3", rectify: false });
    expect(off.prep.rectify).toMatchObject({ scope: "full-frame", reason: "disabled" });
    const bench = prepareForOcr(png, "image/png", { mode: "gray", psm: "3" });
    expect("rectify" in bench.prep).toBe(false);
    expect(Buffer.compare(bench.image, off.image)).toBe(0); // switched off = exactly the pre-D-50 pipeline
  });
});

describe("wordsToOriginal: word boxes land on the photo as uploaded", () => {
  const word = (x: number, y: number, w: number, h: number): OcrWord => ({ text: "INV-1", confidence: 0.9, bbox: { field: "word", x, y, w, h, page: 1 } });

  it("rectified page → photo: a box on the page maps onto the same region of the photo", () => {
    const opts = photoOptions({ pitchDeg: 20, yawDeg: 15 }, "CLM-U5");
    const shot = photograph(textPage(), opts);
    const { rectify } = rectifyForOcr(shot.image, true);
    const prep: OcrPrep = { preprocessed: true, skewDeg: 0, threshold: null, method: "gray", inkRatio: 0.1, psm: "3", rectify };
    // The header block, normalised to the page (60..330 × 50..80 of 680 × 880).
    const [mapped] = wordsToOriginal([word(60 / W, 50 / H, 270 / W, 30 / H)], prep);
    const pageToPhoto = mat3Inverse(shot.groundTruth);
    const pts = [
      { x: 60, y: 50 },
      { x: 330, y: 50 },
      { x: 330, y: 80 },
      { x: 60, y: 80 },
    ].map((p) => applyH(pageToPhoto, p));
    const expected = { x: Math.min(...pts.map((p) => p.x)) / W, y: Math.min(...pts.map((p) => p.y)) / H, x1: Math.max(...pts.map((p) => p.x)) / W, y1: Math.max(...pts.map((p) => p.y)) / H };
    expect(mapped.bbox.x).toBeCloseTo(expected.x, 2);
    expect(mapped.bbox.y).toBeCloseTo(expected.y, 2);
    expect(mapped.bbox.x + mapped.bbox.w).toBeCloseTo(expected.x1, 2);
    expect(mapped.bbox.y + mapped.bbox.h).toBeCloseTo(expected.y1, 2);
    // And it is NOT where the unmapped box would have been drawn.
    expect(Math.abs(mapped.bbox.x - 60 / W)).toBeGreaterThan(0.03);
  });

  it("undoes the clean-up's deskew on a full-frame read", () => {
    const skewDeg = 2;
    const rectify = rectifyForOcr(textPage(), true).rectify; // flat scan: full frame
    const prep: OcrPrep = { preprocessed: true, skewDeg, threshold: null, method: "gray", inkRatio: 0.1, psm: "3", rectify };
    // A point in the photo, rotated by −skew about the centre the way deskewAndScale does, then normalised.
    const src = { x: 600, y: 120 };
    const r = (-skewDeg * Math.PI) / 180;
    const [dx, dy] = [src.x - W / 2, src.y - H / 2];
    const deskewed = { x: (dx * Math.cos(r) - dy * Math.sin(r) + W / 2) / W, y: (dx * Math.sin(r) + dy * Math.cos(r) + H / 2) / H };
    const [mapped] = wordsToOriginal([word(deskewed.x, deskewed.y, 0, 0)], prep);
    expect(mapped.bbox.x * W).toBeCloseTo(src.x, 3);
    expect(mapped.bbox.y * H).toBeCloseTo(src.y, 3);
  });

  it("leaves words from a raw read, or with no rectify record, untouched", () => {
    const words = [word(0.1, 0.2, 0.1, 0.02)];
    expect(wordsToOriginal(words, { preprocessed: false, skewDeg: null, threshold: null, method: null, inkRatio: null, psm: "3" })).toBe(words);
    expect(wordsToOriginal(words, { preprocessed: true, skewDeg: 1, threshold: null, method: "gray", inkRatio: 0.1, psm: "3" })).toBe(words);
  });
});

describe("hint and switch", () => {
  it("the claim page hints only when OCR read the full frame", () => {
    expect(rectifyHint(null)).toBeNull();
    expect(rectifyHint({ scope: "page", reason: "rectified" })).toBeNull();
    expect(rectifyHint({ scope: "full-frame", reason: "no-page" })).toMatch(/Page edges not found/);
    expect(rectifyHint({ scope: "full-frame", reason: "flat-scan" })).toMatch(/flat scan/);
    expect(rectifyHint({ scope: "full-frame", reason: "disabled" })).toMatch(/OCR_RECTIFY=off/);
    expect(rectifyHint({ scope: "full-frame", reason: "prep-fallback" })).toMatch(/could not run/);
  });

  it("OCR_RECTIFY defaults to on and accepts only on / off", () => {
    expect(readEnv({ DATABASE_URL: "file:./dev.db" }).OCR_RECTIFY).toBe("on");
    expect(readEnv({ DATABASE_URL: "file:./dev.db", OCR_RECTIFY: "off" }).OCR_RECTIFY).toBe("off");
    expect(() => readEnv({ DATABASE_URL: "file:./dev.db", OCR_RECTIFY: "yes" })).toThrow(/OCR_RECTIFY/);
  });
});
