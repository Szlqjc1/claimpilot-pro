import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { cornerError, detectPageCorners, rectifiedSize, rectifyPage } from "@/lib/ai/corners";
import { decodeToRgba } from "@/lib/ai/ocr-prep";
import type { Rgba } from "@/lib/ai/perspective";
import { detectedCapture, photoOptions } from "@/lib/bench/capture";
import { deskTexture, photograph, projectedCorners } from "@/lib/bench/photo";

// Page-corner detection and rectification (D-49), on synthetic photos with known ground truth.

const W = 680;
const H = 880;

/** A letter-shaped page: white, with dark "text lines" inside a margin (no ink touches the page edge). */
function page(): Rgba {
  const data = new Uint8ClampedArray(W * H * 4).fill(255);
  for (let y = 70; y < H - 70; y += 22)
    for (let x = 60; x < W - 60; x++) {
      if ((x * 7 + y) % 47 >= 28 || (y / 22) % 4 === 0) continue;
      for (let dy = 0; dy < 8; dy++) data.fill(25, ((y + dy) * W + x) * 4, ((y + dy) * W + x) * 4 + 3);
    }
  return { data, width: W, height: H };
}

const doc = page();
const ANGLES = [
  { pitchDeg: 0, yawDeg: 0 },
  { pitchDeg: 10, yawDeg: 10 },
  { pitchDeg: 20, yawDeg: 15 },
  { pitchDeg: 25, yawDeg: -20 },
  { pitchDeg: -15, yawDeg: 25 },
];

describe("detectPageCorners", () => {
  for (const angles of ANGLES) {
    it(`finds all four corners within 1 px at pitch ${angles.pitchDeg} / yaw ${angles.yawDeg}`, () => {
      const opts = photoOptions(angles, `CLM-T-${angles.pitchDeg}-${angles.yawDeg}`);
      const { image } = photograph(doc, opts);
      const found = detectPageCorners(image);
      expect(found).not.toBeNull();
      const err = cornerError(found!.corners, projectedCorners({ w: W, h: H }, opts));
      expect(err.max).toBeLessThan(1);
      expect(found!.source).toBe("region"); // the D-49 path, unchanged for clean photos
      expect(found!.solidity!).toBeGreaterThan(0.95);
    });
  }

  it("orders the corners TL, TR, BR, BL even with a few degrees of roll", () => {
    const opts = { ...photoOptions({ pitchDeg: 10, yawDeg: 10 }, "CLM-R"), rollDeg: -8 };
    const found = detectPageCorners(photograph(doc, opts).image)!;
    const [tl, tr, br, bl] = found.corners;
    expect(tl.x).toBeLessThan(tr.x);
    expect(bl.x).toBeLessThan(br.x);
    expect(tl.y).toBeLessThan(bl.y);
    expect(tr.y).toBeLessThan(br.y);
    expect(cornerError(found.corners, projectedCorners({ w: W, h: H }, opts)).max).toBeLessThan(1);
  });

  it("returns null when there is no page: bare desk, flat gray, a tiny white patch", () => {
    expect(detectPageCorners(deskTexture(W, H, 3))).toBeNull();
    expect(detectPageCorners({ data: new Uint8ClampedArray(W * H * 4).fill(128), width: W, height: H })).toBeNull();
    const desk = deskTexture(W, H, 5);
    for (let y = 400; y < 440; y++) desk.data.fill(255, (y * W + 300) * 4, (y * W + 340) * 4);
    expect(detectPageCorners(desk)).toBeNull();
  });

  it("returns null on a bright blob that is not a quadrilateral (a disc)", () => {
    const img = deskTexture(W, H, 9);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) if (Math.hypot(x - W / 2, y - H / 2) < 300) img.data.fill(250, (y * W + x) * 4, (y * W + x) * 4 + 3);
    expect(detectPageCorners(img)).toBeNull();
  });

  it("is deterministic", () => {
    const { image } = photograph(doc, photoOptions({ pitchDeg: 20, yawDeg: 15 }, "CLM-D"));
    expect(detectPageCorners(image)).toEqual(detectPageCorners(image));
  });
});

describe("generated desk photos: lit desk merges with the page (D-51, src/tests/fixtures/photos)", () => {
  // Reviewed detector output (see the fixtures README); a regression guard, not independent ground truth.
  const CASES: { file: string; corners: number[][] }[] = [
    { file: "generated-de-rechnung.jpg", corners: [[34, 347], [702, 172], [1266, 864], [482, 1102]] },
    { file: "generated-zh-receipt.jpg", corners: [[108, 393], [800, 209], [1169, 814], [397, 1066]] },
    { file: "generated-en-invoice.jpg", corners: [[112, 333], [789, 156], [1234, 922], [431, 1116]] },
  ];
  for (const c of CASES) {
    it(`${c.file}: found by the edge stage, every corner within 8 px of the reviewed position`, () => {
      const img = decodeToRgba(readFileSync(path.resolve("src/tests/fixtures/photos", c.file)), "image/jpeg");
      const found = detectPageCorners(img);
      expect(found).not.toBeNull();
      expect(found!.source).toBe("edges");
      found!.corners.forEach((p, i) => expect(Math.hypot(p.x - c.corners[i][0], p.y - c.corners[i][1])).toBeLessThan(8));
    });
  }

  it("the in-frame rule: on the German photo the sunlit band (corner off the photo) is not taken for the page", () => {
    const img = decodeToRgba(readFileSync(path.resolve("src/tests/fixtures/photos/generated-de-rechnung.jpg")), "image/jpeg");
    const found = detectPageCorners(img)!;
    expect(Math.min(...found.corners.map((p) => p.x))).toBeGreaterThan(0);
    expect(Math.min(...found.corners.map((p) => p.y))).toBeGreaterThan(100); // the band's top corner was at y ≈ 20
  });
});

describe("rectifyPage", () => {
  it("detected corners give back the flat page: a text line lands where it was printed", () => {
    const opts = photoOptions({ pitchDeg: 20, yawDeg: 15 }, "CLM-F");
    const { image } = photograph(doc, opts);
    const found = detectPageCorners(image)!;
    const size = rectifiedSize(found.corners);
    // Foreshortened edges: the estimated size is smaller than the page but keeps roughly its shape.
    expect(size.w).toBeLessThan(W);
    expect(Math.abs(size.h / size.w - H / W)).toBeLessThan(0.1);
    // At the page's own size the rectified photo matches the page almost everywhere (light and resampling aside).
    const flat = rectifyPage(image, found.corners, { w: W, h: H });
    let agree = 0;
    let n = 0;
    for (let y = 2; y < H - 2; y += 3)
      for (let x = 2; x < W - 2; x += 3) {
        const o = (y * W + x) * 4;
        if ((doc.data[o] < 128) === (flat.data[o] < 128)) agree++;
        n++;
      }
    expect(agree / n).toBeGreaterThan(0.97);
    expect(flat.data[3]).toBe(255); // no transparent pixels reach OCR
  });

  it("the A3 capture arm detects, rectifies and reports the corner error", () => {
    const { image, detection } = detectedCapture(doc, "CLM-A3", "20-15");
    expect(detection.found).toBe(true);
    expect(detection.errorPx!.max).toBeLessThan(1);
    expect(image.width).toBe(detection.size!.w);
  });
});
