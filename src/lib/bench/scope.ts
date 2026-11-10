// Scope arms (Task 16 A, DECISIONS D-56): what else is in the photo besides the one invoice. Pure and deterministic.
//
//   S0  one invoice filling most of the frame, mild tilt                      (control)
//   S1  two complete invoices side by side; the target is the LEFT one        (which page does the crop pick?)
//   S2  one invoice plus background text: a printed page's corner, a label   (does background text get read?)
//   S3  one invoice with its right edge out of frame                          (does a missing edge cost a field?)
//
// Every sheet is placed by a quad in scene pixels and warped in with the D-47 primitives, composited over the desk,
// then lit unevenly, like the perspective arms. The true quads come back with the scene so the benchmark can say
// which region the detector chose.
import { homographyFromQuad, warpPerspective, type Pt, type Rgba } from "@/lib/ai/perspective";
import { deskTexture, projectedCorners, unevenLight } from "./photo";
import { seedOf } from "./capture";

/** Bump when any scene's pixels change, so cached OCR text from an older scene is never reused. */
export const SCOPE_VERSION = "scope1";

export type ScopeArm = "S0" | "S1" | "S2" | "S3";
export const SCOPE_ARMS: { id: ScopeArm; label: string }[] = [
  { id: "S0", label: "S0 one invoice filling the frame" },
  { id: "S1", label: "S1 two invoices side by side" },
  { id: "S2", label: "S2 invoice + background text" },
  { id: "S3", label: "S3 one edge out of frame" },
];

export type Quad = [Pt, Pt, Pt, Pt];
export type Sheet = { img: Rgba; quad: Quad };
export type Scene = { image: Rgba; target: Quad; other: Quad | null };

const DESK = deskTexture(512, 512, 7);

/** An upright rectangle w × h centred at (cx, cy), rotated by `rollDeg`, as a TL, TR, BR, BL quad. */
export function rectQuad(cx: number, cy: number, w: number, h: number, rollDeg = 0): Quad {
  const a = (rollDeg * Math.PI) / 180;
  const [c, s] = [Math.cos(a), Math.sin(a)];
  return [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ].map(([x, y]) => ({ x: cx + c * x - s * y, y: cy + s * x + c * y })) as Quad;
}

/** Warp each sheet into its quad, over a tiled desk, then uneven light. Later sheets lie on top. */
export function composeScene(size: { w: number; h: number }, sheets: Sheet[], lightSeed: number): Rgba {
  const out = new Uint8ClampedArray(size.w * size.h * 4);
  for (let y = 0; y < size.h; y++)
    for (let x = 0; x < size.w; x++) {
      const o = (y * size.w + x) * 4;
      const b = ((y % DESK.height) * DESK.width + (x % DESK.width)) * 4;
      out[o] = DESK.data[b];
      out[o + 1] = DESK.data[b + 1];
      out[o + 2] = DESK.data[b + 2];
      out[o + 3] = 255;
    }
  for (const { img, quad } of sheets) {
    const corners = [
      { x: 0, y: 0 },
      { x: img.width, y: 0 },
      { x: img.width, y: img.height },
      { x: 0, y: img.height },
    ];
    // Sampling map: scene pixel → sheet pixel. Outside the sheet the warp leaves alpha 0.
    const layer = warpPerspective(img, homographyFromQuad(quad, corners), size);
    for (let o = 0; o < out.length; o += 4) {
      const a = layer.data[o + 3] / 255;
      if (a === 0) continue;
      for (let k = 0; k < 3; k++) out[o + k] = layer.data[o + k] * a + out[o + k] * (1 - a);
    }
  }
  return unevenLight({ data: out, width: size.w, height: size.h }, 0.3, lightSeed);
}

/**
 * The scene for one arm. `target` is the invoice under test; `other` is a different invoice (S1: the right-hand
 * page; S2: the printed page whose corner shows); `label` is a shipping label (S2). `index` alternates which S1
 * page is nearer the camera (4 % larger), so "the largest page wins" is visible in the results.
 */
export function buildScene(arm: ScopeArm, parts: { target: Rgba; other?: Rgba; label?: Rgba }, docKey: string, index: number): Scene {
  const { target } = parts;
  const [pw, ph] = [target.width, target.height];
  const light = seedOf(`${docKey}|scope|${arm}`);
  if (arm === "S0") {
    // Like a careful phone photo: the page spans 82 % of the frame, slight tilt and roll.
    const size = { w: pw, h: ph };
    const quad = projectedCorners({ w: pw, h: ph }, { pitchDeg: 8, yawDeg: 6, rollDeg: 2, offsetX: 0, offsetY: 0, pageScale: 0.82 }) as Quad;
    return { image: composeScene(size, [{ img: target, quad }], light), target: quad, other: null };
  }
  if (arm === "S1") {
    if (!parts.other) throw new Error("S1 needs the other invoice");
    // Landscape frame, two pages side by side with desk between and around them.
    const size = { w: ph, h: pw };
    const k = (0.44 * size.w) / pw; // each page about 44 % of the frame width
    const [kl, kr] = index % 2 === 0 ? [k * 1.04, k] : [k, k * 1.04];
    const o = parts.other;
    const left = rectQuad(size.w * 0.26, size.h / 2, pw * kl, ph * kl, 1.5);
    const right = rectQuad(size.w * 0.74, size.h / 2, o.width * kr, o.height * kr, -1);
    return { image: composeScene(size, [{ img: target, quad: left }, { img: o, quad: right }], light), target: left, other: right };
  }
  if (arm === "S2") {
    if (!parts.other || !parts.label) throw new Error("S2 needs the background page and the label");
    const size = { w: pw, h: ph };
    const k = 0.6;
    const page = rectQuad(size.w * 0.35, size.h * 0.36, pw * k, ph * k, 2);
    // A shipping label on the desk to the right of the invoice.
    const lk = (0.27 * size.w) / parts.label.width;
    const label = rectQuad(size.w * 0.83, size.h * 0.2, parts.label.width * lk, parts.label.height * lk, -4);
    // Another printed invoice, its top-left corner reaching into the frame's lower right, rotated 15°.
    const o = parts.other;
    const ok = (0.6 * size.w) / o.width;
    const [w, h] = [o.width * ok, o.height * ok];
    const a = (-15 * Math.PI) / 180;
    const tl = { x: size.w * 0.6, y: size.h * 0.74 };
    const corner: Quad = [
      tl,
      { x: tl.x + Math.cos(a) * w, y: tl.y + Math.sin(a) * w },
      { x: tl.x + Math.cos(a) * w - Math.sin(a) * h, y: tl.y + Math.sin(a) * w + Math.cos(a) * h },
      { x: tl.x - Math.sin(a) * h, y: tl.y + Math.cos(a) * h },
    ];
    return { image: composeScene(size, [{ img: o, quad: corner }, { img: parts.label, quad: label }, { img: target, quad: page }], light), target: page, other: corner };
  }
  // S3: the page large in frame, shifted right so 3 % of its width is cut off by the frame's right edge.
  const size = { w: pw, h: ph };
  const k = 0.9;
  const [w, h] = [pw * k, ph * k];
  const quad = rectQuad(size.w + 0.03 * w - w / 2, size.h / 2, w, h, 1.5);
  return { image: composeScene(size, [{ img: target, quad }], light), target: quad, other: null };
}

/** The part of a quad inside the frame, for S3: a corner beyond the right edge moves along its top/bottom side to x = W. */
export function clipRight(q: Quad, W: number): Quad {
  const clip = (inside: Pt, outside: Pt): Pt => {
    if (outside.x <= W) return outside;
    const t = (W - inside.x) / (outside.x - inside.x);
    return { x: W, y: inside.y + t * (outside.y - inside.y) };
  };
  return [q[0], clip(q[0], q[1]), clip(q[3], q[2]), q[3]];
}

export type CropVerdict = "target" | "other" | "other region" | "none";

/** Which sheet the detector's quad is: mean corner distance under 3 % of the frame's shorter side. */
export function cropVerdict(found: Pt[] | null, target: Quad, other: Quad | null, frame: { w: number; h: number }): { verdict: CropVerdict; meanErrPx: number | null } {
  if (!found) return { verdict: "none", meanErrPx: null };
  const err = (q: Quad) => found.reduce((s, p, i) => s + Math.hypot(p.x - q[i].x, p.y - q[i].y), 0) / 4;
  const tol = 0.03 * Math.min(frame.w, frame.h);
  const eT = err(target);
  if (eT <= tol) return { verdict: "target", meanErrPx: Math.round(eT * 10) / 10 };
  if (other && err(other) <= tol) return { verdict: "other", meanErrPx: Math.round(err(other) * 10) / 10 };
  return { verdict: "other region", meanErrPx: Math.round(eT * 10) / 10 };
}
