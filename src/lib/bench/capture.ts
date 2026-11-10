// Capture arms for the variant benchmark (Task 14, D-47): what happens to a clean render between the printer and the
// OCR. Pure and deterministic: the same render and claim ID always give the same image bytes.
import { PNG } from "pngjs";
import jpeg from "jpeg-js";
import { mat3Inverse, warpPerspective, type Rgba } from "./perspective";
import { deskTexture, photograph, rng } from "./photo";

/** Bump when any capture's pixels change, so cached OCR text from an older capture is never reused. */
export const CAPTURE_VERSION = "cap1";

export type CaptureId = "none" | "photo-10-10" | "photo-20-15" | "oracle-10-10" | "oracle-20-15" | "shadow" | "clutter" | "low-contrast";

export const PERSPECTIVE_ARMS: { id: CaptureId; label: string }[] = [
  { id: "none", label: "A0 baseline" },
  { id: "photo-10-10", label: "A1 pitch 10 / yaw 10" },
  { id: "photo-20-15", label: "A1 pitch 20 / yaw 15" },
  { id: "oracle-10-10", label: "A2 oracle-rectified (10/10)" },
  { id: "oracle-20-15", label: "A2 oracle-rectified (20/15)" },
];

/** Capture-quality arms (Task 14 B2, D-48), each layered on the canonical render. */
export const QUALITY_ARMS: { id: CaptureId; label: string }[] = [
  { id: "none", label: "clean scan" },
  { id: "shadow", label: "shadow (one third)" },
  { id: "clutter", label: "clutter (desk + 2 objects)" },
  { id: "low-contrast", label: "low contrast 60 % + JPEG q25" },
];

/** A stable 32-bit seed from a string (FNV-1a). */
export function seedOf(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

const DESK = deskTexture(512, 512, 7);

/** The photo parameters for one document: fixed angles, seeded offset and light (docs/PERSPECTIVE.md). */
export function photoOptions(angles: { pitchDeg: number; yawDeg: number }, docKey: string) {
  const r = rng(seedOf(docKey));
  return {
    ...angles,
    rollDeg: 2,
    offsetX: (r() - 0.5) * 0.04,
    offsetY: (r() - 0.5) * 0.04,
    background: DESK,
    unevenLight: 0.3,
    seed: seedOf(`${docKey}|light`),
  };
}

const ANGLES: Record<string, { pitchDeg: number; yawDeg: number }> = { "10-10": { pitchDeg: 10, yawDeg: 10 }, "20-15": { pitchDeg: 20, yawDeg: 15 } };

/** Apply a capture arm to a decoded render. `docKey` (the claim ID) seeds everything random. */
export function applyCapture(id: CaptureId, render: Rgba, docKey: string): Rgba {
  if (id === "none") return render;
  if (id === "shadow") return shadow(render);
  if (id === "clutter") return clutter(render, docKey);
  if (id === "low-contrast") return lowContrast(render, 0.6);
  const [kind, angleKey] = [id.split("-")[0], id.slice(id.indexOf("-") + 1)];
  const shot = photograph(render, photoOptions(ANGLES[angleKey], docKey));
  if (kind === "photo") return shot.image;
  // Oracle: undo the geometry with the TRUE homography (page → photo is the sampling map for the page frame).
  const flat = warpPerspective(shot.image, mat3Inverse(shot.groundTruth), { w: render.width, h: render.height });
  // Outside the photo nothing can be sampled; paint it white like paper rather than leaving transparent pixels.
  for (let o = 0; o < flat.data.length; o += 4) {
    const a = flat.data[o + 3] / 255;
    for (let k = 0; k < 3; k++) flat.data[o + k] = flat.data[o + k] * a + 255 * (1 - a);
    flat.data[o + 3] = 255;
  }
  return flat;
}

export function decodePng(buf: Buffer): Rgba {
  const png = PNG.sync.read(buf);
  return { data: png.data, width: png.width, height: png.height };
}

export function encodePng(img: Rgba): Buffer {
  const png = new PNG({ width: img.width, height: img.height });
  png.data = Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength);
  return PNG.sync.write(png);
}

export function encodeJpeg(img: Rgba, quality: number): Buffer {
  return Buffer.from(jpeg.encode({ data: Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength), width: img.width, height: img.height }, quality).data);
}

/** The bytes and type the OCR pipeline receives for an arm: PNG, except low contrast, which is a quality-25 JPEG. */
export function captureBytes(id: CaptureId, render: Rgba, docKey: string): { buf: Buffer; mime: "image/png" | "image/jpeg" } {
  const img = applyCapture(id, render, docKey);
  return id === "low-contrast" ? { buf: encodeJpeg(img, 25), mime: "image/jpeg" } : { buf: encodePng(img), mime: "image/png" };
}

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/**
 * A soft shadow across one third of the page, as from a hand or a phone held over it: the right third darkens to
 * 40 % brightness at the edge, with a soft penumbra and a slight diagonal so it is not aligned with the text columns.
 */
export function shadow(img: Rgba): Rgba {
  const { width: w, height: h } = img;
  const out = new Uint8ClampedArray(img.data);
  for (let y = 0; y < h; y++) {
    const edge = (2 / 3) * w - 0.06 * w * (y / h); // the shadow's boundary leans by 6 % of the width top to bottom
    for (let x = 0; x < w; x++) {
      const k = 1 - 0.6 * smoothstep(edge - 0.05 * w, edge + 0.08 * w, x);
      const o = (y * w + x) * 4;
      out[o] *= k;
      out[o + 1] *= k;
      out[o + 2] *= k;
    }
  }
  return { data: out, width: w, height: h };
}

/**
 * The page flat on a desk (no tilt), with two objects overlapping its edges: a coffee mug over the top-right corner
 * and a pen across the lower-left edge. Seeded from the document so every arm sees the same desk.
 */
export function clutter(img: Rgba, docKey: string): Rgba {
  const { width: w, height: h } = img;
  const flat = photograph(img, { pitchDeg: 0, yawDeg: 0, rollDeg: 0, offsetX: 0, offsetY: 0, background: DESK, pageScale: 0.86, seed: seedOf(`${docKey}|clutter`) }).image;
  const out = new Uint8ClampedArray(flat.data);
  const r = rng(seedOf(`${docKey}|objects`));
  // Page box in the photo (scale 0.86, centred).
  const px0 = w * 0.07;
  const py0 = h * 0.07;
  const px1 = w * 0.93;
  const py1 = h * 0.93;
  // Mug: a dark ring with a lighter rim, centred just outside the page's top-right corner.
  const mx = px1 - w * (0.02 + r() * 0.02);
  const my = py0 + h * (0.01 + r() * 0.02);
  const R = w * 0.1;
  // Pen: a dark rotated bar crossing the lower-left page edge.
  const ang = (-20 + r() * 10) * (Math.PI / 180);
  const cx = px0 + w * 0.02;
  const cy = py1 - h * (0.18 + r() * 0.06);
  const [ca, sa] = [Math.cos(ang), Math.sin(ang)];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const d = Math.hypot(x - mx, y - my);
      let c: [number, number, number] | null = null;
      if (d < R) c = d > R * 0.86 ? [235, 232, 225] : [60 + 20 * (d / R), 38, 28];
      const u = (x - cx) * ca + (y - cy) * sa;
      const v = -(x - cx) * sa + (y - cy) * ca;
      if (Math.abs(u) < w * 0.17 && Math.abs(v) < w * 0.009) c = [25, 35, 80];
      if (c) [out[o], out[o + 1], out[o + 2]] = c;
    }
  }
  return { data: out, width: w, height: h };
}

/** Contrast around mid-grey: v' = 128 + (v − 128) · k (k = 0.6 → white 204, black 51). */
export function lowContrast(img: Rgba, k: number): Rgba {
  const out = new Uint8ClampedArray(img.data);
  for (let o = 0; o < out.length; o += 4) for (let c = 0; c < 3; c++) out[o + c] = 128 + (out[o + c] - 128) * k;
  return { data: out, width: img.width, height: img.height };
}
