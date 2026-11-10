// Page-corner detection and rectification for photographed invoices (Task 14 follow-up, DECISIONS D-49).
// Pure TypeScript, no dependency, deterministic, deliberately NOT server-only (like ocr-prep.ts) so the benchmark
// runs the exact code an upload would.
//
// Model: a page lighter than what surrounds it, roughly upright (each page edge within ~40° of its axis), fully in
// frame. Grayscale, box-downscale to ≤ DETECT_MAX_DIM px, then candidate quads from two sources, tried in order:
//   1a. region (D-49): Otsu threshold → largest 4-connected bright component → outer boundary → extreme corners
//       (min/max of x ± y) → a total-least-squares line per side → intersections. Exact when the page is the only
//       bright thing in the photo; it fails when lit desk merges with the page (D-51).
//   1b. edges (D-51): Sobel gradient → thin edges → a Hough transform that votes only along each pixel's gradient
//       direction, so every line knows which side is brighter → the strongest lines, each re-fitted to its edge pixels
//       → every four lines whose bright sides face inward form a quad, scored by how much of its perimeter is edge.
//   2. fine (both): back at full resolution, each side is re-located by scanning across it for the strongest
//      dark-to-bright step towards the inside (sub-pixel, averaged along the edge), a robust line fit, and the corners
//      re-intersected; then the sanity checks and the page/background step check. The first candidate that passes
//      wins.
// It returns null instead of guessing when no candidate passes.
import { homographyFromQuad, warpPerspective, type Pt, type Rgba } from "./perspective";
import { otsuThreshold, toGray, type GrayImage } from "./preprocess";

/** Part of the benchmark's cache key for detected arms. Bump on any change to the detector or the rectifier. */
export const CORNER_DETECTOR_VERSION = "corners-v3";
export const DETECT_MAX_DIM = 400;
/** The page must cover at least this fraction of the photo. */
export const MIN_PAGE_FRACTION = 0.1;
/** Mean gray level of the bright class minus the dark class, on the downscaled image. */
export const MIN_CONTRAST = 50;
/** Filled component area / fitted quad area. A page is ≈ 1; a ragged bright blob is not. */
export const MIN_SOLIDITY = 0.9;

/** Top-left, top-right, bottom-right, bottom-left, in photo pixels (pixel edges, not centres: (0,0) is the corner). */
export type PageQuad = [Pt, Pt, Pt, Pt];
export type CornerSource = "region" | "edges";
export type CornerDetection = {
  corners: PageQuad;
  /** Which candidate generator found it. */
  source: CornerSource;
  threshold: number;
  contrast: number;
  /** Region candidates: filled area / quad area. Null for edge candidates. */
  solidity: number | null;
  /** Edge candidates: the weakest side's share of its length with edge evidence. Null for region candidates. */
  support: number | null;
  factor: number;
};
type Candidate = { quad: PageQuad; source: CornerSource; solidity: number | null; support: number | null };

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
 * along the side and find the strongest dark-to-bright step towards the inside (parabolic sub-pixel peak). For a
 * clockwise quad (TL → TR → BR → BL in image coordinates) the left normal of each side points inwards. Returns the
 * refined line, or the coarse one if too few stations found an edge.
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
      const grad = prof[i + 1] - prof[i - 1]; // signed: brighter inwards (a shadow line inside the page is the wrong way)
      if (grad > bestG) [bestG, bestI] = [grad, i];
    }
    if (bestI < 0 || bestG < 20) continue; // no clear page/desk step here (an object over the edge, say)
    // Parabola through the central-difference gradient at bestI − 1, bestI, bestI + 1.
    const g0 = bestI > 1 ? prof[bestI] - prof[bestI - 2] : bestG;
    const g2 = bestI < prof.length - 2 ? prof[bestI + 2] - prof[bestI] : bestG;
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
  if (small.width < 8 || small.height < 8) return null;

  const threshold = otsuThreshold(small.data);
  let [sumHi, nHi, sumLo, nLo] = [0, 0, 0, 0];
  for (const v of small.data) {
    if (v > threshold) {
      sumHi += v;
      nHi++;
    } else {
      sumLo += v;
      nLo++;
    }
  }
  const contrast = nHi && nLo ? sumHi / nHi - sumLo / nLo : 0;

  const tryCandidate = (c: Candidate): CornerDetection | null => {
    const corners = finish(gray, c.quad, factor, img);
    return corners ? { corners, source: c.source, threshold, contrast, solidity: c.solidity, support: c.support, factor } : null;
  };
  // The region candidate first: exact and cheap when the page is the only bright thing. The edge stage runs only
  // when it fails.
  const region = contrast >= MIN_CONTRAST ? regionCandidate(small, threshold) : null;
  const fromRegion = region && tryCandidate(region);
  if (fromRegion) return fromRegion;
  for (const c of edgeCandidates(small)) {
    const found = tryCandidate(c);
    if (found) return found;
  }
  return null;
}

/** Fine stage and checks for one coarse candidate (small-image coordinates). Null when it does not hold up. */
function finish(gray: GrayImage, coarse: PageQuad, factor: number, img: Rgba): PageQuad | null {
  const full = coarse.map((p) => ({ x: p.x * factor, y: p.y * factor }));
  const radius = 2 * factor + 2;
  const fine = cornersFromSides(full.map((a, i) => refineSide(gray, a, full[(i + 1) % 4], radius)));
  // quadArea > 0 also means clockwise (TL → TR → BR → BL), which refineSide's inward normal relies on.
  const corners = fine && isConvex(fine) && quadArea(fine) >= MIN_PAGE_FRACTION * img.width * img.height ? fine : null;
  if (!corners) return null;
  // A sane page lies (almost) inside the photo; a corner far outside means a side fit went wrong.
  const slack = 0.05 * Math.max(img.width, img.height);
  if (corners.some((p) => p.x < -slack || p.y < -slack || p.x > img.width + slack || p.y > img.height + slack)) return null;
  // A page edge is a STEP: paper inside, darker background outside. A table border inside a flat scan is a line with
  // paper on both sides; without this check its interior could pass for the page and the header would be cropped.
  if (!corners.every((_, i) => sideIsStep(gray, corners, i))) return null;
  return corners;
}

/** Stage 1a (D-49): the largest bright region, if its outline is a clean quadrilateral. */
function regionCandidate(small: GrayImage, threshold: number): Candidate | null {
  const { width: w, height: h } = small;
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) mask[i] = small.data[i] > threshold ? 1 : 0;
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
  return { quad: coarse, source: "region", solidity, support: null };
}

/** Minimum Sobel magnitude (on the 3×3-blurred downscaled image) for an edge pixel; ≈ a 10-level step. */
const EDGE_MIN_MAG = 40;
/** Lines kept from the Hough transform, and the best-scoring quads handed to the fine stage. */
const EDGE_LINES = 24;
const EDGE_KEEP = 6;
/** Every side of an edge quad needs edge evidence along at least this share of its length. */
export const EDGE_MIN_SUPPORT = 0.4;

type HoughLine = { theta: number; line: Line };

/**
 * Stage 1b (D-51): quads from straight edges. The Hough transform votes only within ±3° of each edge pixel's gradient
 * direction, over 0–360°, so a line's angle is the normal pointing to its BRIGHTER side. A page's four sides then
 * have inward normals that turn by roughly 90° each going round: sorted by angle from the one closest to "down"
 * (90°, the top side) they are top, right, bottom, left.
 */
function edgeCandidates(small: GrayImage): Candidate[] {
  const { width: w, height: h } = small;
  // 3×3 box blur, then Sobel.
  const b = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += small.data[Math.min(h - 1, Math.max(0, y + dy)) * w + Math.min(w - 1, Math.max(0, x + dx))];
      b[y * w + x] = s / 9;
    }
  const mag = new Float32Array(w * h);
  const ang = new Float32Array(w * h).fill(Number.NaN); // gradient direction (towards brighter), radians; NaN = no edge
  const gxA = new Float32Array(w * h);
  const gyA = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = b[i - w + 1] + 2 * b[i + 1] + b[i + w + 1] - b[i - w - 1] - 2 * b[i - 1] - b[i + w - 1];
      const gy = b[i + w - 1] + 2 * b[i + w] + b[i + w + 1] - b[i - w - 1] - 2 * b[i - w] - b[i - w + 1];
      gxA[i] = gx;
      gyA[i] = gy;
      mag[i] = Math.hypot(gx, gy);
    }
  // Thin edges: keep local maxima along the gradient (non-maximum suppression, 4 directions).
  const edges: { x: number; y: number; a: number }[] = [];
  for (let y = 2; y < h - 2; y++)
    for (let x = 2; x < w - 2; x++) {
      const i = y * w + x;
      const m = mag[i];
      if (m < EDGE_MIN_MAG) continue;
      const a = Math.atan2(gyA[i], gxA[i]);
      const q = Math.round((((a * 180) / Math.PI + 180) % 180) / 45) % 4; // 0: horizontal gradient, 1: 45°, 2: vertical, 3: 135°
      const [dx, dy] = [
        [1, 0],
        [1, 1],
        [0, 1],
        [-1, 1],
      ][q];
      if (m < mag[i + dy * w + dx] || m < mag[i - dy * w - dx]) continue;
      ang[i] = a;
      edges.push({ x: x + 0.5, y: y + 0.5, a });
    }
  if (edges.length < 20) return [];

  // Oriented Hough: θ in whole degrees 0..359 (normal towards the brighter side), ρ in px.
  const D = Math.ceil(Math.hypot(w, h));
  const R = 2 * D + 1;
  const acc = new Float32Array(360 * R);
  const COS = Array.from({ length: 360 }, (_, t) => Math.cos((t * Math.PI) / 180));
  const SIN = Array.from({ length: 360 }, (_, t) => Math.sin((t * Math.PI) / 180));
  for (const e of edges) {
    const t0 = Math.round((e.a * 180) / Math.PI);
    for (let dt = -3; dt <= 3; dt++) {
      const t = (t0 + dt + 720) % 360;
      acc[t * R + Math.round(e.x * COS[t] + e.y * SIN[t]) + D] += 1;
    }
  }
  const minVotes = 0.12 * Math.min(w, h);
  const peaks: { t: number; r: number; v: number }[] = [];
  for (let t = 0; t < 360; t++)
    for (let r = 0; r < R; r++) {
      const v = acc[t * R + r];
      if (v >= minVotes) peaks.push({ t, r, v });
    }
  peaks.sort((p, q) => q.v - p.v || p.t - q.t || p.r - q.r);
  const angDiff = (p: number, q: number) => {
    const d = Math.abs(p - q) % 360;
    return d > 180 ? 360 - d : d;
  };
  const lines: HoughLine[] = [];
  for (const pk of peaks) {
    if (lines.length >= EDGE_LINES) break;
    const rho = pk.r - D;
    if (lines.some((l) => angDiff(l.theta, pk.t) <= 5 && Math.abs(l.line.p.x * COS[pk.t] + l.line.p.y * SIN[pk.t] - rho) <= 6)) continue;
    // Re-fit to the edge pixels it collected: within 1.5 px, gradient within 12° of the normal.
    const n = { x: COS[pk.t], y: SIN[pk.t] };
    const pts = edges.filter((e) => Math.abs(e.x * n.x + e.y * n.y - rho) <= 1.5 && angDiff((e.a * 180) / Math.PI, pk.t) <= 12);
    const fit = pts.length >= minVotes / 2 ? fitLine(pts) : null;
    const line: Line = fit ?? { p: { x: rho * n.x, y: rho * n.y }, d: { x: -n.y, y: n.x } };
    // Normal of the fitted line, oriented like the peak (towards the brighter side).
    let nx = -line.d.y;
    let ny = line.d.x;
    if (nx * n.x + ny * n.y < 0) [nx, ny] = [-nx, -ny];
    const theta = (((Math.atan2(ny, nx) * 180) / Math.PI) % 360 + 360) % 360;
    lines.push({ theta, line });
  }
  if (lines.length < 4) return [];

  // Edge evidence at a point: an edge pixel in its 3×3 neighbourhood whose gradient is within 20° of `normalDeg`.
  const evidence = (x: number, y: number, normalDeg: number) => {
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const [px, py] = [cx + dx, cy + dy];
        if (px < 0 || py < 0 || px >= w || py >= h) continue;
        const a = ang[py * w + px];
        if (!Number.isNaN(a) && angDiff((a * 180) / Math.PI, normalDeg) <= 20) return true;
      }
    return false;
  };
  // The page is wholly in frame (the model), so an edge quad's corners must be too. Without this a sunlit band of desk
  // that runs off the photo and contains the page outscores the page itself.
  const slack = 0.01 * Math.max(w, h);
  const scored: (Candidate & { score: number })[] = [];
  const L = lines.length;
  for (let i = 0; i < L; i++)
    for (let j = i + 1; j < L; j++)
      for (let k = j + 1; k < L; k++)
        for (let m = k + 1; m < L; m++) {
          const four = [lines[i], lines[j], lines[k], lines[m]].sort((p, q) => p.theta - q.theta);
          // Inward normals turning by 40–140° per side, all the way round.
          let ok = true;
          for (let s = 0; s < 4 && ok; s++) {
            const gap = (four[(s + 1) % 4].theta - four[s].theta + 360) % 360;
            ok = gap >= 40 && gap <= 140;
          }
          if (!ok) continue;
          // Start at the side whose inward normal is closest to "down": top, right, bottom, left.
          let top = 0;
          for (let s = 1; s < 4; s++) if (angDiff(four[s].theta, 90) < angDiff(four[top].theta, 90)) top = s;
          const sides = [0, 1, 2, 3].map((s) => four[(top + s) % 4]);
          const quad = cornersFromSides(sides.map((l) => l.line));
          if (!quad || !isConvex(quad) || quadArea(quad) < MIN_PAGE_FRACTION * w * h) continue;
          if (quad.some((p) => p.x < -slack || p.y < -slack || p.x > w + slack || p.y > h + slack)) continue;
          // Support: share of each side (away from its corners) with edge evidence facing inwards.
          let score = 0;
          let minSupport = 1;
          for (let s = 0; s < 4; s++) {
            const [a, c] = [quad[s], quad[(s + 1) % 4]];
            const len = Math.hypot(c.x - a.x, c.y - a.y);
            let hits = 0;
            const N = 24;
            for (let u = 0; u < N; u++) {
              const f = 0.08 + (0.84 * u) / (N - 1);
              if (evidence(a.x + (c.x - a.x) * f, a.y + (c.y - a.y) * f, sides[s].theta)) hits++;
            }
            const support = hits / N;
            minSupport = Math.min(minSupport, support);
            score += support * len;
          }
          if (minSupport < EDGE_MIN_SUPPORT) continue;
          scored.push({ quad, source: "edges", solidity: null, support: minSupport, score });
        }
  scored.sort((p, q) => q.score - p.score);
  return scored.slice(0, EDGE_KEEP).map((c) => ({ quad: c.quad, source: c.source, solidity: c.solidity, support: c.support }));
}

/** Minimum median (inside − outside) gray difference across an interior page side. */
export const MIN_EDGE_STEP = 30;
/** Band either side of a page side, px from the fitted edge. */
const STEP_BAND = { from: 3, to: 20 };

const median = (v: number[]) => {
  const s = [...v].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

/**
 * Is side i (corner i → i+1) a page/background step? At 16 stations along the side, the MEDIAN gray of a band 3–20 px
 * inside is compared with the median of the band 3–20 px outside. Medians, so a ruled line (a table border, up to
 * ~8 px) does not count as a darker background. Stations whose outside band leaves the photo are skipped: a side on
 * the frame edge (a flat scan) cannot be judged and passes, leaving it to the caller's flat-scan guard.
 */
function sideIsStep(g: GrayImage, q: PageQuad, i: number): boolean {
  const [a, b] = [q[i], q[(i + 1) % 4]];
  const c = { x: (q[0].x + q[1].x + q[2].x + q[3].x) / 4, y: (q[0].y + q[1].y + q[2].y + q[3].y) / 4 };
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  let n = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  if ((mid.x - c.x) * n.x + (mid.y - c.y) * n.y < 0) n = { x: -n.x, y: -n.y }; // outward
  const inFrame = (x: number, y: number) => x >= 0 && y >= 0 && x <= g.width && y <= g.height;
  const diffs: number[] = [];
  for (let k = 0; k < 16; k++) {
    const u = 0.15 + (0.7 * k) / 15;
    const p = { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
    if (!inFrame(p.x + n.x * STEP_BAND.to, p.y + n.y * STEP_BAND.to)) continue;
    const inside: number[] = [];
    const outside: number[] = [];
    for (let d = STEP_BAND.from; d <= STEP_BAND.to; d++) {
      inside.push(sampleGray(g, p.x - n.x * d, p.y - n.y * d));
      outside.push(sampleGray(g, p.x + n.x * d, p.y + n.y * d));
    }
    diffs.push(median(inside) - median(outside));
  }
  if (diffs.length < 4) return true;
  return median(diffs) >= MIN_EDGE_STEP;
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
