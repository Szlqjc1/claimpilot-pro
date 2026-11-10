// Page-corner detection and rectification for photographed invoices (Task 14 follow-up, DECISIONS D-49).
// Pure TypeScript, no dependency, deterministic, deliberately NOT server-only (like ocr-prep.ts) so the benchmark
// runs the exact code an upload would.
//
// Model: a light page on a darker desk, roughly upright (each page edge within ~40° of its axis), fully in frame.
//   1. coarse: grayscale → box-downscale to ≤ DETECT_MAX_DIM px → Otsu threshold → largest 4-connected bright
//      component → its outer boundary (row and column extremes) → four extreme corners (min/max of x ± y) →
//      a total-least-squares line per side through the boundary samples between them → corners = line intersections;
//   2. fine: back at full resolution, each side is re-located by scanning across it for the strongest step edge
//      (sub-pixel, averaged along the edge), a robust line fit, and the corners re-intersected.
// It returns null instead of guessing: no component big enough, too little page/desk contrast, a boundary that is not
// quadrilateral (solidity), or a degenerate / non-convex result.
import { homographyFromQuad, warpPerspective, type Pt, type Rgba } from "./perspective";
import { otsuThreshold, toGray, type GrayImage } from "./preprocess";

/** Part of the benchmark's cache key for detected arms. Bump on any change to the detector or the rectifier. */
export const CORNER_DETECTOR_VERSION = "corners-v1";
export const DETECT_MAX_DIM = 400;
/** The page must cover at least this fraction of the photo. */
export const MIN_PAGE_FRACTION = 0.1;
/** Mean gray level of the bright class minus the dark class, on the downscaled image. */
export const MIN_CONTRAST = 50;
/** Filled component area / fitted quad area. A page is ≈ 1; a ragged bright blob is not. */
export const MIN_SOLIDITY = 0.9;

/** Top-left, top-right, bottom-right, bottom-left, in photo pixels (pixel edges, not centres: (0,0) is the corner). */
export type PageQuad = [Pt, Pt, Pt, Pt];
export type CornerDetection = { corners: PageQuad; threshold: number; contrast: number; solidity: number; factor: number };

type Line = { p: Pt; d: Pt }; // a point on the line and a unit direction

/** Box-average downscale by an integer factor (partial blocks at the right / bottom are dropped). */
function downscale(g: GrayImage, f: number): GrayImage {
  const w = Math.floor(g.width / f);
  const h = Math.floor(g.height / f);
  const out = new Uint8Array(w * h);
  const area = f * f;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let dy = 0; dy < f; dy++) {
        const row = (y * f + dy) * g.width + x * f;
        for (let dx = 0; dx < f; dx++) s += g.data[row + dx];
      }
      out[y * w + x] = Math.round(s / area);
    }
  return { data: out, width: w, height: h };
}

/** Label of the largest 4-connected component of `mask`, with its pixel count. */
function largestComponent(mask: Uint8Array, w: number, h: number): { labels: Int32Array; label: number; size: number } {
  const labels = new Int32Array(w * h);
  const stack = new Int32Array(w * h);
  let next = 0;
  let best = { label: 0, size: 0 };
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || labels[i]) continue;
    const label = ++next;
    let top = 0;
    let size = 0;
    stack[top++] = i;
    labels[i] = label;
    while (top) {
      const p = stack[--top];
      size++;
      const x = p % w;
      const y = (p - x) / w;
      const visit = (q: number) => {
        if (mask[q] && !labels[q]) {
          labels[q] = label;
          stack[top++] = q;
        }
      };
      if (x > 0) visit(p - 1);
      if (x < w - 1) visit(p + 1);
      if (y > 0) visit(p - w);
      if (y < h - 1) visit(p + w);
    }
    if (size > best.size) best = { label, size };
  }
  return { labels, ...best };
}

/** Total-least-squares line through points (principal axis of their scatter). Null with fewer than two points. */
function fitLine(pts: Pt[]): Line | null {
  if (pts.length < 2) return null;
  let mx = 0;
  let my = 0;
  for (const p of pts) {
    mx += p.x;
    my += p.y;
  }
  mx /= pts.length;
  my /= pts.length;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const p of pts) {
    const [dx, dy] = [p.x - mx, p.y - my];
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { p: { x: mx, y: my }, d: { x: Math.cos(theta), y: Math.sin(theta) } };
}

/** Fit, drop points more than `tol` from the line, fit again. */
function robustLine(pts: Pt[], tol: number): Line | null {
  const first = fitLine(pts);
  if (!first) return null;
  const kept = pts.filter((q) => Math.abs(cross(first.d, sub(q, first.p))) <= tol);
  return kept.length >= Math.max(2, pts.length / 3) ? fitLine(kept) : first;
}

const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const cross = (a: Pt, b: Pt) => a.x * b.y - a.y * b.x;

function intersect(a: Line, b: Line): Pt | null {
  const den = cross(a.d, b.d);
  if (Math.abs(den) < 1e-6) return null;
  const t = cross(sub(b.p, a.p), b.d) / den;
  return { x: a.p.x + t * a.d.x, y: a.p.y + t * a.d.y };
}

function quadArea(q: Pt[]): number {
  let s = 0;
  for (let i = 0; i < q.length; i++) s += cross(q[i], q[(i + 1) % q.length]);
  return s / 2; // positive for TL→TR→BR→BL in image coordinates (y down)
}

function isConvex(q: Pt[]): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const c = cross(sub(q[(i + 1) % 4], q[i]), sub(q[(i + 2) % 4], q[(i + 1) % 4]));
    if (Math.abs(c) < 1e-9) return false;
    if (sign && Math.sign(c) !== sign) return false;
    sign = Math.sign(c);
  }
  return true;
}

/** Corners from four side lines (top, right, bottom, left). */
function cornersFromSides(sides: Line[]): PageQuad | null {
  const q = [intersect(sides[3], sides[0]), intersect(sides[0], sides[1]), intersect(sides[1], sides[2]), intersect(sides[2], sides[3])];
  return q.every((p): p is Pt => p !== null) ? (q as PageQuad) : null;
}

/** Bilinear gray sample at a continuous position (pixel centres at +0.5), clamped to the image. */
function sampleGray(g: GrayImage, x: number, y: number): number {
  const sx = Math.max(0, Math.min(g.width - 1, x - 0.5));
  const sy = Math.max(0, Math.min(g.height - 1, y - 0.5));
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const x1 = Math.min(g.width - 1, x0 + 1);
  const y1 = Math.min(g.height - 1, y0 + 1);
  const fx = sx - x0;
  const fy = sy - y0;
  const d = g.data;
  const top = d[y0 * g.width + x0] + (d[y0 * g.width + x1] - d[y0 * g.width + x0]) * fx;
  const bot = d[y1 * g.width + x0] + (d[y1 * g.width + x1] - d[y1 * g.width + x0]) * fx;
  return top + (bot - top) * fy;
}

/**
 * Re-locate one side at full resolution: at evenly spaced stations along the coarse side, average a short strip
 * along the side and find the strongest step across it (parabolic sub-pixel peak). Returns the refined line, or the
 * coarse one if too few stations found an edge.
 */
function refineSide(g: GrayImage, a: Pt, b: Pt, radius: number): Line {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const t = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  const n = { x: -t.y, y: t.x };
  const STATIONS = 48;
  const STRIP = 3; // px either side along the edge
  const STEP = 0.5;
  const steps = Math.ceil(radius / STEP);
  const pts: Pt[] = [];
  for (let k = 0; k < STATIONS; k++) {
    const u = 0.1 + (0.8 * k) / (STATIONS - 1);
    const c = { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
    const prof: number[] = [];
    for (let s = -steps; s <= steps; s++) {
      let v = 0;
      for (let w = -STRIP; w <= STRIP; w++) v += sampleGray(g, c.x + n.x * s * STEP + t.x * w, c.y + n.y * s * STEP + t.y * w);
      prof.push(v / (2 * STRIP + 1));
    }
    let bestI = -1;
    let bestG = 0;
    for (let i = 1; i < prof.length - 1; i++) {
      const grad = Math.abs(prof[i + 1] - prof[i - 1]);
      if (grad > bestG) [bestG, bestI] = [grad, i];
    }
    if (bestI < 0 || bestG < 20) continue; // no clear page/desk step here (an object over the edge, say)
    // Parabola through the central-difference gradient at bestI − 1, bestI, bestI + 1.
    const g0 = bestI > 1 ? Math.abs(prof[bestI] - prof[bestI - 2]) : bestG;
    const g2 = bestI < prof.length - 2 ? Math.abs(prof[bestI + 2] - prof[bestI]) : bestG;
    const den = g0 - 2 * bestG + g2;
    const off = Math.abs(den) > 1e-9 ? Math.max(-0.5, Math.min(0.5, (0.5 * (g0 - g2)) / den)) : 0;
    const s = (bestI + off - steps) * STEP;
    pts.push({ x: c.x + n.x * s, y: c.y + n.y * s });
  }
  const line = pts.length >= STATIONS / 3 ? robustLine(pts, 1.5) : null;
  return line ?? { p: a, d: t };
}

/** Find the four page corners in a photo, or null when no page is found. */
export function detectPageCorners(img: Rgba): CornerDetection | null {
  const gray = toGray(img);
  const factor = Math.max(1, Math.ceil(Math.max(img.width, img.height) / DETECT_MAX_DIM));
  const small = downscale(gray, factor);
  const { width: w, height: h } = small;
  if (w < 8 || h < 8) return null;

  const threshold = otsuThreshold(small.data);
  const mask = new Uint8Array(w * h);
  let [sumHi, nHi, sumLo, nLo] = [0, 0, 0, 0];
  for (let i = 0; i < mask.length; i++) {
    const v = small.data[i];
    if (v > threshold) {
      mask[i] = 1;
      sumHi += v;
      nHi++;
    } else {
      sumLo += v;
      nLo++;
    }
  }
  if (!nHi || !nLo) return null;
  const contrast = sumHi / nHi - sumLo / nLo;
  if (contrast < MIN_CONTRAST) return null;

  const { labels, label, size } = largestComponent(mask, w, h);
  if (size < MIN_PAGE_FRACTION * w * h) return null;

  // Outer boundary: first / last component pixel of every row and column (pixel-edge coordinates).
  const boundary: Pt[] = [];
  let filled = 0;
  for (let y = 0; y < h; y++) {
    let x0 = -1;
    let x1 = -1;
    for (let x = 0; x < w; x++)
      if (labels[y * w + x] === label) {
        if (x0 < 0) x0 = x;
        x1 = x;
      }
    if (x0 < 0) continue;
    filled += x1 - x0 + 1;
    boundary.push({ x: x0, y: y + 0.5 }, { x: x1 + 1, y: y + 0.5 });
  }
  for (let x = 0; x < w; x++) {
    let y0 = -1;
    let y1 = -1;
    for (let y = 0; y < h; y++)
      if (labels[y * w + x] === label) {
        if (y0 < 0) y0 = y;
        y1 = y;
      }
    if (y0 >= 0) boundary.push({ x: x + 0.5, y: y0 }, { x: x + 0.5, y: y1 + 1 });
  }

  // Extreme corners: TL = min(x + y), TR = max(x − y), BR = max(x + y), BL = min(x − y).
  const pick = (score: (p: Pt) => number) => boundary.reduce((best, p) => (score(p) > score(best) ? p : best));
  const rough = [pick((p) => -(p.x + p.y)), pick((p) => p.x - p.y), pick((p) => p.x + p.y), pick((p) => p.y - p.x)];

  // Coarse sides: TLS line through the boundary samples near each rough side, away from its ends.
  const coarseSides: Line[] = [];
  for (let i = 0; i < 4; i++) {
    const [a, b] = [rough[i], rough[(i + 1) % 4]];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 4) return null;
    const d = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    const near = boundary.filter((p) => {
      const v = sub(p, a);
      const along = (v.x * d.x + v.y * d.y) / len;
      return along > 0.1 && along < 0.9 && Math.abs(cross(d, v)) < 2.5;
    });
    const line = robustLine(near, 1.5);
    if (!line) return null;
    coarseSides.push(line);
  }
  const coarse = cornersFromSides(coarseSides);
  if (!coarse || !isConvex(coarse)) return null;

  const solidity = filled / quadArea(coarse);
  if (!(solidity >= MIN_SOLIDITY)) return null;

  // Fine: refine each side at full resolution around the coarse estimate (scaled up).
  const full = coarse.map((p) => ({ x: p.x * factor, y: p.y * factor }));
  const radius = 2 * factor + 2;
  const fine = cornersFromSides(full.map((a, i) => refineSide(gray, a, full[(i + 1) % 4], radius)));
  const corners = fine && isConvex(fine) && quadArea(fine) >= MIN_PAGE_FRACTION * img.width * img.height ? fine : null;
  if (!corners) return null;
  // A sane page lies (almost) inside the photo; a corner far outside means a side fit went wrong.
  const slack = 0.05 * Math.max(img.width, img.height);
  if (corners.some((p) => p.x < -slack || p.y < -slack || p.x > img.width + slack || p.y > img.height + slack)) return null;
  return { corners, threshold, contrast, solidity, factor };
}

/** The flat-page size for a quad: the longer of each pair of opposite sides (no upscaling, no aspect snapping). */
export function rectifiedSize(q: PageQuad): { w: number; h: number } {
  const d = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);
  return { w: Math.round(Math.max(d(q[0], q[1]), d(q[3], q[2]))), h: Math.round(Math.max(d(q[0], q[3]), d(q[1], q[2]))) };
}

/**
 * Warp the quad in `img` to a flat, upright page of `size` (default: rectifiedSize). Pixels the photo cannot supply
 * are painted white like paper, as in the oracle arm.
 */
export function rectifyPage(img: Rgba, corners: PageQuad, size = rectifiedSize(corners)): Rgba {
  const page: Pt[] = [
    { x: 0, y: 0 },
    { x: size.w, y: 0 },
    { x: size.w, y: size.h },
    { x: 0, y: size.h },
  ];
  // Sampling map for the page frame: page → photo.
  const flat = warpPerspective(img, homographyFromQuad(page, corners), size);
  for (let o = 0; o < flat.data.length; o += 4) {
    const a = flat.data[o + 3] / 255;
    for (let k = 0; k < 3; k++) flat.data[o + k] = flat.data[o + k] * a + 255 * (1 - a);
    flat.data[o + 3] = 255;
  }
  return flat;
}

/** Mean and max distance between detected and true corners, in px. */
export function cornerError(found: Pt[], truth: Pt[]): { mean: number; max: number } {
  const e = found.map((p, i) => Math.hypot(p.x - truth[i].x, p.y - truth[i].y));
  return { mean: e.reduce((s, v) => s + v, 0) / e.length, max: Math.max(...e) };
}
