// Synthetic "phone photo" of a flat invoice (Task 14 Part A, D-47). Pure and deterministic (seeded).
//
// The page lies on the desk plane, is rotated in 3D (pitch about the horizontal axis, yaw about the vertical axis,
// a small in-plane roll), and is projected by a pinhole camera. A plane under a pinhole projection is exactly a
// homography, so the photo is the page warped by that homography, composited over the desk, then lit unevenly.
// The returned `groundTruth` maps PHOTO pixels to FLAT-PAGE pixels; warpPerspective(photo, mat3Inverse(groundTruth),
// page size) undoes the geometry exactly (the oracle arm). It cannot undo the light or the resampling.
import { homographyFromQuad, mat3Inverse, warpPerspective, type Mat3, type Pt, type Rgba } from "./perspective";

export type PhotoOptions = {
  pitchDeg: number;
  yawDeg: number;
  /** In-plane rotation; keep it small (2–3°). */
  rollDeg: number;
  /** Shift of the page centre in the photo, as a fraction of the photo width / height. */
  offsetX: number;
  offsetY: number;
  /** Desk surface, tiled under the page. */
  background: Rgba;
  /** 0 = flat light; 0.35 = the darkest corner at 65 % brightness. */
  unevenLight?: number;
  /** Seeds the light direction. */
  seed?: number;
  /** Fraction of the photo the unrotated page spans (default 0.8: some desk shows round the page). */
  pageScale?: number;
};

/** mulberry32: small, fast, deterministic. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A deterministic wood-ish desk: warm base, low-frequency grain, a little noise. */
export function deskTexture(w: number, h: number, seed = 7): Rgba {
  const r = rng(seed);
  const phase = r() * 10;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const grain = Math.sin(y / 23 + Math.sin(x / 310 + phase) * 3) * 0.5 + 0.5;
      const n = (r() - 0.5) * 10;
      const o = (y * w + x) * 4;
      data[o] = 120 + grain * 40 + n;
      data[o + 1] = 82 + grain * 28 + n;
      data[o + 2] = 52 + grain * 18 + n;
      data[o + 3] = 255;
    }
  }
  return { data, width: w, height: h };
}

const rad = (d: number) => (d * Math.PI) / 180;

/** Where the four page corners land in the photo (top-left, top-right, bottom-right, bottom-left). */
export function projectedCorners(page: { w: number; h: number }, opts: Pick<PhotoOptions, "pitchDeg" | "yawDeg" | "rollDeg" | "offsetX" | "offsetY" | "pageScale">): Pt[] {
  const { w: W, h: H } = page;
  const s = opts.pageScale ?? 0.8;
  // A phone-like field of view: the frame diagonal subtends ~64°, so the camera sits ~0.8 diagonals away.
  const D = 0.8 * Math.hypot(W, H);
  const [cp, sp] = [Math.cos(rad(opts.pitchDeg)), Math.sin(rad(opts.pitchDeg))];
  const [cy, sy] = [Math.cos(rad(opts.yawDeg)), Math.sin(rad(opts.yawDeg))];
  const [cr, sr] = [Math.cos(rad(opts.rollDeg)), Math.sin(rad(opts.rollDeg))];
  const corners: Pt[] = [
    { x: 0, y: 0 },
    { x: W, y: 0 },
    { x: W, y: H },
    { x: 0, y: H },
  ];
  return corners.map(({ x, y }) => {
    // Page plane, centred, scaled.
    let X = s * (x - W / 2);
    let Y = s * (y - H / 2);
    let Z = 0;
    // R = Rz(roll) · Ry(yaw) · Rx(pitch), applied right to left.
    [Y, Z] = [cp * Y - sp * Z, sp * Y + cp * Z];
    [X, Z] = [cy * X + sy * Z, -sy * X + cy * Z];
    [X, Y] = [cr * X - sr * Y, sr * X + cr * Y];
    // Translate in front of the camera and project.
    const Zc = Z + D;
    return { x: (D * X) / Zc + W / 2 + opts.offsetX * W, y: (D * Y) / Zc + H / 2 + opts.offsetY * H };
  });
}

/** Multiply brightness by a smooth, seeded field: a linear gradient plus a soft vignette. */
export function unevenLight(img: Rgba, strength: number, seed: number): Rgba {
  if (strength <= 0) return img;
  const r = rng(seed);
  const angle = r() * Math.PI * 2;
  const [dx, dy] = [Math.cos(angle), Math.sin(angle)];
  const { width: w, height: h } = img;
  const out = new Uint8ClampedArray(img.data);
  const half = Math.hypot(w, h) / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = ((x - w / 2) * dx + (y - h / 2) * dy) / half; // −1 … 1 along the light direction
      const v = Math.hypot(x - w / 2, y - h / 2) / half; // 0 centre … 1 corner
      const k = 1 - strength * (0.65 * (u * 0.5 + 0.5) + 0.35 * v * v);
      const o = (y * w + x) * 4;
      out[o] *= k;
      out[o + 1] *= k;
      out[o + 2] *= k;
    }
  }
  return { data: out, width: w, height: h };
}

/** Alpha-composite `top` over a tiled `background` (same output size as `top`). */
export function compositeOver(top: Rgba, background: Rgba): Rgba {
  const { width: w, height: h } = top;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const b = (((y % background.height) * background.width + (x % background.width)) * 4) | 0;
      const a = top.data[o + 3] / 255;
      for (let k = 0; k < 3; k++) out[o + k] = top.data[o + k] * a + background.data[b + k] * (1 - a);
      out[o + 3] = 255;
    }
  }
  return { data: out, width: w, height: h };
}

/** Photograph a flat page. The photo has the page's pixel size; `groundTruth` maps photo → flat page. */
export function photograph(doc: Rgba, opts: PhotoOptions): { image: Rgba; groundTruth: Mat3 } {
  const size = { w: doc.width, h: doc.height };
  const pageCorners: Pt[] = [
    { x: 0, y: 0 },
    { x: size.w, y: 0 },
    { x: size.w, y: size.h },
    { x: 0, y: size.h },
  ];
  const pageToPhoto = homographyFromQuad(pageCorners, projectedCorners(size, opts));
  const groundTruth = mat3Inverse(pageToPhoto);
  // Sampling map for the photo frame is photo → page, i.e. the ground truth itself.
  const warped = warpPerspective(doc, groundTruth, size);
  const image = unevenLight(compositeOver(warped, opts.background), opts.unevenLight ?? 0, opts.seed ?? 1);
  return { image, groundTruth };
}
