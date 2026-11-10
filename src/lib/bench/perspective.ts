// Perspective primitives for the capture benchmark (Task 14 Part A, D-47). Pure TypeScript, no dependency.
//
// Convention: a homography H maps a point p to H·p in homogeneous coordinates (x, y, 1). warpPerspective takes the
// SAMPLING map: destination pixel (x, y) is read from the source at m·(x, y). So to draw image A into frame B you pass
// the map B → A. (OpenCV's warpPerspective takes A → B and inverts it internally; this one does not invert.)

export type Pt = { x: number; y: number };
export type Mat3 = [number, number, number, number, number, number, number, number, number];
export type Rgba = { data: Uint8Array | Uint8ClampedArray; width: number; height: number };

export const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** Apply H to a point. */
export function applyH(m: Mat3, p: Pt): Pt {
  const w = m[6] * p.x + m[7] * p.y + m[8];
  return { x: (m[0] * p.x + m[1] * p.y + m[2]) / w, y: (m[3] * p.x + m[4] * p.y + m[5]) / w };
}

export function mat3Mul(a: Mat3, b: Mat3): Mat3 {
  const r = new Array(9).fill(0) as number[];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return r as Mat3;
}

/** Solve A·x = b by Gaussian elimination with partial pivoting (A is n×n, row-major). */
function solve(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    if (Math.abs(m[p][c]) < 1e-12) throw new Error("homographyFromQuad: degenerate quadrilateral");
    [m[c], m[p]] = [m[p], m[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r][c] / m[c][c];
      for (let k = c; k <= n; k++) m[r][k] -= f * m[c][k];
    }
  }
  return m.map((row, i) => row[n] / row[i]);
}

/**
 * The homography H with H·src[i] = dst[i] for four point pairs (DLT with h33 = 1: an 8×8 linear system, two
 * equations per correspondence). No three points of either quad may be collinear.
 */
export function homographyFromQuad(srcQuad: Pt[], dstQuad: Pt[]): Mat3 {
  if (srcQuad.length !== 4 || dstQuad.length !== 4) throw new Error("homographyFromQuad: need exactly 4 points each");
  for (const q of [srcQuad, dstQuad]) {
    for (let i = 0; i < 4; i++) {
      const [p, r, t] = [q[i], q[(i + 1) % 4], q[(i + 2) % 4]];
      if (Math.abs((r.x - p.x) * (t.y - p.y) - (r.y - p.y) * (t.x - p.x)) < 1e-9) throw new Error("homographyFromQuad: degenerate quadrilateral (three collinear points)");
    }
  }
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = srcQuad[i];
    const { x: u, y: v } = dstQuad[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = solve(A, b);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

/** Inverse of a 3×3 matrix (adjugate / determinant), normalised so m[8] = 1 when possible. */
export function mat3Inverse(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-15) throw new Error("mat3Inverse: singular matrix");
  const inv: Mat3 = [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d].map((v) => v / det) as Mat3;
  return Math.abs(inv[8]) > 1e-12 ? (inv.map((v) => v / inv[8]) as Mat3) : inv;
}

/**
 * Bilinear perspective warp. Destination pixel (x, y) (pixel centres at +0.5) is sampled from `img` at m·(x, y).
 * Samples outside the source are transparent (alpha 0) so the caller can composite a background under them.
 */
export function warpPerspective(img: Rgba, m: Mat3, size: { w: number; h: number }): Rgba {
  const { w, h } = size;
  const out = new Uint8ClampedArray(w * h * 4);
  const sw = img.width;
  const sh = img.height;
  const src = img.data;
  for (let y = 0; y < h; y++) {
    const py = y + 0.5;
    for (let x = 0; x < w; x++) {
      const px = x + 0.5;
      const wq = m[6] * px + m[7] * py + m[8];
      const sx = (m[0] * px + m[1] * py + m[2]) / wq - 0.5;
      const sy = (m[3] * px + m[4] * py + m[5]) / wq - 0.5;
      if (sx < -0.5 || sy < -0.5 || sx > sw - 0.5 || sy > sh - 0.5) continue;
      const x0 = Math.max(0, Math.min(sw - 1, Math.floor(sx)));
      const y0 = Math.max(0, Math.min(sh - 1, Math.floor(sy)));
      const x1 = Math.min(sw - 1, x0 + 1);
      const y1 = Math.min(sh - 1, y0 + 1);
      const fx = Math.max(0, Math.min(1, sx - x0));
      const fy = Math.max(0, Math.min(1, sy - y0));
      const o = (y * w + x) * 4;
      const i00 = (y0 * sw + x0) * 4;
      const i10 = (y0 * sw + x1) * 4;
      const i01 = (y1 * sw + x0) * 4;
      const i11 = (y1 * sw + x1) * 4;
      for (let k = 0; k < 4; k++) {
        const top = src[i00 + k] + (src[i10 + k] - src[i00 + k]) * fx;
        const bot = src[i01 + k] + (src[i11 + k] - src[i01 + k]) * fx;
        out[o + k] = top + (bot - top) * fy;
      }
    }
  }
  return { data: out, width: w, height: h };
}
