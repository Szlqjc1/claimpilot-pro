// Image clean-up before Tesseract (uploads only; Task 7b Part B). Pure, deterministic, no dependencies:
// operates on a decoded RGBA buffer and returns a binarised grayscale buffer (0 = ink, 255 = paper).
//   1. grayscale
//   2. skew estimate over −3°…+3° in 0.5° steps: maximise the variance of the horizontal projection profile of a
//      downscaled, binarised copy (text lines produce sharp peaks only when they are horizontal)
//   3. rotate back and upscale 2× in one bilinear resample
//   4. binarise with Otsu; under a strong illumination gradient, fall back to a 32 px tiled threshold
// Optional before step 2 (D-52): illumination normalisation — divide by an estimate of the paper brightness, so a
// shadow or uneven light does not push a region of text below Tesseract's single global threshold.

export type RgbaImage = { data: Uint8Array | Uint8ClampedArray; width: number; height: number };
export type GrayImage = { data: Uint8Array; width: number; height: number };
export type PreprocessResult = GrayImage & { skewDeg: number; threshold: number; method: "otsu" | "tiled" | "gray"; inkRatio: number };
/** binarize: false keeps the deskewed, upscaled grayscale (Tesseract then applies its own binarisation). */
export type PreprocessOptions = { binarize?: boolean; illumination?: boolean };

export const SKEW_RANGE_DEG = 3;
export const SKEW_STEP_DEG = 0.5;
export const UPSCALE = 2;
export const TILE = 32;
/** Tile-median spread (gray levels) above which one global threshold is unsafe. */
export const GRADIENT_LIMIT = 60;

export function toGray(img: RgbaImage): GrayImage {
  const { width, height, data } = img;
  const out = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    // Composite over white so transparent PNG regions read as paper.
    const a = data[p + 3] / 255;
    const y = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
    out[i] = Math.round(y * a + 255 * (1 - a));
  }
  return { data: out, width, height };
}

/** Otsu's threshold over a histogram of gray levels. Pixels ≤ threshold are ink. */
export function otsuThreshold(values: ArrayLike<number>, from = 0, to = values.length): number {
  const hist = new Array<number>(256).fill(0);
  for (let i = from; i < to; i++) hist[values[i]]++;
  return otsuFromHistogram(hist);
}

function otsuFromHistogram(hist: number[]): number {
  let total = 0;
  let sum = 0;
  for (let t = 0; t < 256; t++) {
    total += hist[t];
    sum += t * hist[t];
  }
  if (total === 0) return 127;
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
}

function downscaleGray(img: GrayImage, maxWidth: number): GrayImage {
  if (img.width <= maxWidth) return img;
  const f = img.width / maxWidth;
  const w = maxWidth;
  const h = Math.max(1, Math.round(img.height / f));
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy0 = Math.floor(y * f);
    const sy1 = Math.min(img.height, Math.max(sy0 + 1, Math.floor((y + 1) * f)));
    for (let x = 0; x < w; x++) {
      const sx0 = Math.floor(x * f);
      const sx1 = Math.min(img.width, Math.max(sx0 + 1, Math.floor((x + 1) * f)));
      let s = 0;
      let n = 0;
      for (let yy = sy0; yy < sy1; yy++) for (let xx = sx0; xx < sx1; xx++, n++) s += img.data[yy * img.width + xx];
      out[y * w + x] = Math.round(s / n);
    }
  }
  return { data: out, width: w, height: h };
}

/**
 * Skew of the text lines, in degrees, positive = content rotated clockwise on screen (y down).
 * Deskewing rotates by −skew. Range ±SKEW_RANGE_DEG, step SKEW_STEP_DEG.
 */
export function estimateSkew(gray: GrayImage): number {
  const small = downscaleGray(gray, 600);
  const t = otsuThreshold(small.data);
  const xs: number[] = [];
  const ys: number[] = [];
  for (let y = 0; y < small.height; y++)
    for (let x = 0; x < small.width; x++) if (small.data[y * small.width + x] <= t) {
      xs.push(x - small.width / 2);
      ys.push(y - small.height / 2);
    }
  if (xs.length < 20) return 0;
  const bins = Math.ceil(Math.hypot(small.width, small.height)) + 2;
  const offset = bins / 2;
  let bestAngle = 0;
  let bestScore = -1;
  for (let a = -SKEW_RANGE_DEG; a <= SKEW_RANGE_DEG + 1e-9; a += SKEW_STEP_DEG) {
    const r = (a * Math.PI) / 180;
    const sin = Math.sin(r);
    const cos = Math.cos(r);
    const profile = new Float64Array(bins);
    // Project each ink pixel onto the axis perpendicular to lines tilted by `a`.
    for (let i = 0; i < xs.length; i++) profile[Math.round(-xs[i] * sin + ys[i] * cos + offset)]++;
    let mean = 0;
    for (let i = 0; i < bins; i++) mean += profile[i];
    mean /= bins;
    let variance = 0;
    for (let i = 0; i < bins; i++) variance += (profile[i] - mean) ** 2;
    // Prefer the smaller |angle| on ties so a straight page reports 0.
    if (variance > bestScore * (1 + 1e-9) || (Math.abs(variance - bestScore) <= bestScore * 1e-9 && Math.abs(a) < Math.abs(bestAngle))) {
      bestScore = variance;
      bestAngle = Number(a.toFixed(1));
    }
  }
  return bestAngle;
}

/** Rotate by −skewDeg about the centre and scale by `scale`, bilinear; outside the source is paper (255). */
export function deskewAndScale(gray: GrayImage, skewDeg: number, scale = UPSCALE): GrayImage {
  const W = Math.round(gray.width * scale);
  const H = Math.round(gray.height * scale);
  const out = new Uint8Array(W * H);
  const r = (skewDeg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const cx = gray.width / 2;
  const cy = gray.height / 2;
  const src = gray.data;
  const sw = gray.width;
  const sh = gray.height;
  for (let v = 0; v < H; v++) {
    const dy = (v + 0.5) / scale - cy;
    for (let u = 0; u < W; u++) {
      const dx = (u + 0.5) / scale - cx;
      // Output is the source rotated by −skew, so sample the source at the +skew rotation of the output point.
      const sx = dx * cos - dy * sin + cx - 0.5;
      const sy = dx * sin + dy * cos + cy - 0.5;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      if (x0 < -1 || y0 < -1 || x0 >= sw || y0 >= sh) {
        out[v * W + u] = 255;
        continue;
      }
      const fx = sx - x0;
      const fy = sy - y0;
      // Inline bilinear sample; pixels outside the source count as paper (255).
      const inX0 = x0 >= 0;
      const inX1 = x0 + 1 < sw;
      const inY0 = y0 >= 0;
      const inY1 = y0 + 1 < sh;
      const r0 = y0 * sw;
      const r1 = r0 + sw;
      const p00 = inX0 && inY0 ? src[r0 + x0] : 255;
      const p10 = inX1 && inY0 ? src[r0 + x0 + 1] : 255;
      const p01 = inX0 && inY1 ? src[r1 + x0] : 255;
      const p11 = inX1 && inY1 ? src[r1 + x0 + 1] : 255;
      const top = p00 + (p10 - p00) * fx;
      const bottom = p01 + (p11 - p01) * fx;
      out[v * W + u] = (top + (bottom - top) * fy + 0.5) | 0;
    }
  }
  return { data: out, width: W, height: H };
}

/** Spread of per-tile medians (8 × 8 grid). Large spread = uneven illumination. */
export function illuminationSpread(gray: GrayImage): number {
  const G = 8;
  const medians: number[] = [];
  for (let ty = 0; ty < G; ty++)
    for (let tx = 0; tx < G; tx++) {
      const x0 = Math.floor((tx * gray.width) / G);
      const x1 = Math.floor(((tx + 1) * gray.width) / G);
      const y0 = Math.floor((ty * gray.height) / G);
      const y1 = Math.floor(((ty + 1) * gray.height) / G);
      const hist = new Array<number>(256).fill(0);
      let n = 0;
      for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2, n++) hist[gray.data[y * gray.width + x]]++;
      if (n === 0) continue;
      let acc = 0;
      for (let t = 0; t < 256; t++) {
        acc += hist[t];
        if (acc >= n / 2) {
          medians.push(t);
          break;
        }
      }
    }
  return medians.length ? Math.max(...medians) - Math.min(...medians) : 0;
}

export function binarizeGlobal(gray: GrayImage, threshold: number): GrayImage {
  const out = new Uint8Array(gray.data.length);
  for (let i = 0; i < out.length; i++) out[i] = gray.data[i] <= threshold ? 0 : 255;
  return { data: out, width: gray.width, height: gray.height };
}

/** Per-tile Otsu; low-contrast tiles (plain paper under shading) become white instead of noise. */
export function binarizeTiled(gray: GrayImage, tile = TILE, minContrast = 30): { image: GrayImage; meanThreshold: number } {
  const { width, height, data } = gray;
  const out = new Uint8Array(data.length).fill(255);
  let tSum = 0;
  let tN = 0;
  for (let y0 = 0; y0 < height; y0 += tile)
    for (let x0 = 0; x0 < width; x0 += tile) {
      const y1 = Math.min(height, y0 + tile);
      const x1 = Math.min(width, x0 + tile);
      const hist = new Array<number>(256).fill(0);
      let lo = 255;
      let hi = 0;
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          const g = data[y * width + x];
          hist[g]++;
          if (g < lo) lo = g;
          if (g > hi) hi = g;
        }
      if (hi - lo < minContrast) continue;
      const t = otsuFromHistogram(hist);
      tSum += t;
      tN++;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (data[y * width + x] <= t) out[y * width + x] = 0;
    }
  return { image: { data: out, width, height }, meanThreshold: tN ? Math.round(tSum / tN) : 127 };
}

export function inkRatio(bin: GrayImage): number {
  let ink = 0;
  for (let i = 0; i < bin.data.length; i++) if (bin.data[i] === 0) ink++;
  return bin.data.length ? ink / bin.data.length : 0;
}

export function preprocess(img: RgbaImage, opts: PreprocessOptions = {}): PreprocessResult {
  const gray = opts.illumination ? normalizeIllumination(toGray(img)) : toGray(img);
  const skewDeg = estimateSkew(gray);
  const scaled = deskewAndScale(gray, skewDeg, UPSCALE);
  let bin: GrayImage;
  let threshold: number;
  let method: "otsu" | "tiled" | "gray";
  if (opts.binarize === false) {
    // Ink ratio is still measured on an Otsu view so the degenerate-output guard works the same way.
    threshold = otsuThreshold(scaled.data);
    return { ...scaled, skewDeg, threshold, method: "gray", inkRatio: inkRatio(binarizeGlobal(scaled, threshold)) };
  }
  if (illuminationSpread(scaled) > GRADIENT_LIMIT) {
    const tiled = binarizeTiled(scaled);
    bin = tiled.image;
    threshold = tiled.meanThreshold;
    method = "tiled";
  } else {
    threshold = otsuThreshold(scaled.data);
    bin = binarizeGlobal(scaled, threshold);
    method = "otsu";
  }
  return { ...bin, skewDeg, threshold, method, inkRatio: inkRatio(bin) };
}

/** Block size (px) for the paper-brightness estimate; 3×3 blocks (96 px) must be wider than any glyph stroke run. */
export const ILLUM_BLOCK = 32;

/**
 * Illumination normalisation (D-52). Estimates the paper brightness at every pixel as the brightest value in its
 * neighbourhood (max over 32 px blocks, dilated 3×3 blocks so a heading glyph never fills a window, then smoothed
 * 3×3 and bilinearly upsampled), and divides by it: paper becomes white everywhere, ink keeps its contrast against
 * the paper around it. A uniformly lit page is unchanged; a shadow is flattened instead of thresholded away.
 */
export function normalizeIllumination(g: GrayImage, block = ILLUM_BLOCK): GrayImage {
  const { width: w, height: h, data } = g;
  const bw = Math.ceil(w / block);
  const bh = Math.ceil(h / block);
  const pooled = new Float32Array(bw * bh);
  for (let y = 0; y < h; y++) {
    const row = Math.floor(y / block) * bw;
    for (let x = 0; x < w; x++) {
      const i = row + Math.floor(x / block);
      const v = data[y * w + x];
      if (v > pooled[i]) pooled[i] = v;
    }
  }
  const at = (a: Float32Array, x: number, y: number) => a[Math.min(bh - 1, Math.max(0, y)) * bw + Math.min(bw - 1, Math.max(0, x))];
  const dilated = new Float32Array(bw * bh);
  const bg = new Float32Array(bw * bh);
  for (let y = 0; y < bh; y++)
    for (let x = 0; x < bw; x++) {
      let m = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) m = Math.max(m, at(pooled, x + dx, y + dy));
      dilated[y * bw + x] = m;
    }
  for (let y = 0; y < bh; y++)
    for (let x = 0; x < bw; x++) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += at(dilated, x + dx, y + dy);
      bg[y * bw + x] = s / 9;
    }
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(bh - 1, Math.max(0, (y + 0.5) / block - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(bh - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(bw - 1, Math.max(0, (x + 0.5) / block - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(bw - 1, x0 + 1);
      const tx = fx - x0;
      const top = bg[y0 * bw + x0] + (bg[y0 * bw + x1] - bg[y0 * bw + x0]) * tx;
      const bot = bg[y1 * bw + x0] + (bg[y1 * bw + x1] - bg[y1 * bw + x0]) * tx;
      const paper = Math.max(16, top + (bot - top) * ty);
      out[y * w + x] = Math.min(255, Math.round((data[y * w + x] * 255) / paper));
    }
  }
  return { data: out, width: w, height: h };
}
