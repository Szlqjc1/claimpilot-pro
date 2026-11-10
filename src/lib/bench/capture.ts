// Capture arms for the variant benchmark (Task 14, D-47): what happens to a clean render between the printer and the
// OCR. Pure and deterministic: the same render and claim ID always give the same image bytes.
import { PNG } from "pngjs";
import jpeg from "jpeg-js";
import { mat3Inverse, warpPerspective, type Rgba } from "./perspective";
import { deskTexture, photograph, rng } from "./photo";

/** Bump when any capture's pixels change, so cached OCR text from an older capture is never reused. */
export const CAPTURE_VERSION = "cap1";

export type CaptureId = "none" | "photo-10-10" | "photo-20-15" | "oracle-10-10" | "oracle-20-15";

export const PERSPECTIVE_ARMS: { id: CaptureId; label: string }[] = [
  { id: "none", label: "A0 baseline" },
  { id: "photo-10-10", label: "A1 pitch 10 / yaw 10" },
  { id: "photo-20-15", label: "A1 pitch 20 / yaw 15" },
  { id: "oracle-10-10", label: "A2 oracle-rectified (10/10)" },
  { id: "oracle-20-15", label: "A2 oracle-rectified (20/15)" },
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
