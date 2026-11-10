import jpeg from "jpeg-js";
import { PNG } from "pngjs";
import type { BoundingBox } from "@/lib/domain/schemas";
import { detectPageCorners, rectifyPage, type PageQuad } from "./corners";
import { applyH, homographyFromQuad, type Mat3, type Pt } from "./perspective";
import { preprocess, type GrayImage, type RgbaImage } from "./preprocess";

// Shared OCR preparation (Task 7b Part B), deliberately NOT server-only so the offline benchmark exercises the
// exact code the app runs. Decodes an upload, cleans it up (src/lib/ai/preprocess.ts) and encodes it for
// Tesseract; any failure or degenerate output falls back to the raw image with a warning, so an upload never
// fails because of preprocessing.

export type PrepMode = "off" | "gray" | "binary";
export type Psm = "default" | "3" | "6";

/**
 * The upload OCR pipeline the app runs, chosen by measurement (docs/GROUNDING_BENCH.md, Part B: raw vs grayscale vs
 * binarised, PSM 3 vs PSM 6, realistic profile) — not by assumption. "default" PSM = tesseract.js's own setting.
 * Set by the benchmark result; see DECISIONS D-39.
 */
export const OCR_PIPELINE: { mode: PrepMode; psm: Psm } = { mode: "gray", psm: "3" };
/** Version of the preprocessing code, part of the benchmark cache key (Task 7b A3). Bump on any change. */
export const OCR_PREP_VERSION = "prep-v1";
export const MIN_INK_RATIO = 0.01;
export const MAX_INK_RATIO = 0.5;

export type OcrPrep = {
  preprocessed: boolean;
  skewDeg: number | null;
  threshold: number | null;
  method: "otsu" | "tiled" | "gray" | null;
  inkRatio: number | null;
  psm: string;
  warning?: string;
  /** Page rectification (D-50). Absent when the caller did not ask (the benchmarks); always set for uploads. */
  rectify?: OcrRectify | null;
};

// ── Page rectification for uploads (D-50) ───────────────────────────────────────────────────────────────────────

/** Flat-scan guard: a quad covering more than this fraction of the frame… */
export const FLAT_MIN_AREA = 0.9;
/** …with every corner within this fraction (of width / height) of its frame corner is the frame itself: no resample. */
export const FLAT_MAX_CORNER_OFFSET = 0.02;

export type RectifyReason = "rectified" | "disabled" | "no-page" | "flat-scan" | "error" | "prep-fallback";
export type OcrRectify = {
  /** "page": OCR read the rectified page. "full-frame": OCR read the photo as uploaded (see reason). */
  scope: "page" | "full-frame";
  reason: RectifyReason;
  /** The uploaded photo's size; corners and pageToPhoto are in its pixels. */
  photo: { width: number; height: number };
  corners: PageQuad | null;
  areaFraction: number | null;
  maxCornerOffset: number | null;
  /** Rectified page size and the page → photo homography (the sampling map); set only when scope is "page". */
  size: { w: number; h: number } | null;
  pageToPhoto: Mat3 | null;
};

function quadAreaOf(q: Pt[]): number {
  let s = 0;
  for (let i = 0; i < 4; i++) s += q[i].x * q[(i + 1) % 4].y - q[(i + 1) % 4].x * q[i].y;
  return Math.abs(s) / 2;
}

/**
 * Detect the page and, unless the flat-scan guard says the page IS the frame, warp it flat. Never throws: any
 * failure leaves the photo as it is, with scope "full-frame" and the reason.
 */
export function rectifyForOcr(photo: RgbaImage, enabled: boolean): { image: RgbaImage; rectify: OcrRectify } {
  const { width: W, height: H } = photo;
  const base: OcrRectify = { scope: "full-frame", reason: "disabled", photo: { width: W, height: H }, corners: null, areaFraction: null, maxCornerOffset: null, size: null, pageToPhoto: null };
  if (!enabled) return { image: photo, rectify: base };
  try {
    const found = detectPageCorners(photo);
    if (!found) return { image: photo, rectify: { ...base, reason: "no-page" } };
    const corners = found.corners;
    const frame = [
      { x: 0, y: 0 },
      { x: W, y: 0 },
      { x: W, y: H },
      { x: 0, y: H },
    ];
    const areaFraction = quadAreaOf(corners) / (W * H);
    const maxCornerOffset = Math.max(...corners.map((p, i) => Math.max(Math.abs(p.x - frame[i].x) / W, Math.abs(p.y - frame[i].y) / H)));
    const measured: OcrRectify = { ...base, corners, areaFraction: Number(areaFraction.toFixed(4)), maxCornerOffset: Number(maxCornerOffset.toFixed(4)) };
    if (areaFraction > FLAT_MIN_AREA && maxCornerOffset < FLAT_MAX_CORNER_OFFSET) return { image: photo, rectify: { ...measured, reason: "flat-scan" } };
    const image = rectifyPage(photo, corners);
    const size = { w: image.width, h: image.height };
    const page = [
      { x: 0, y: 0 },
      { x: size.w, y: 0 },
      { x: size.w, y: size.h },
      { x: 0, y: size.h },
    ];
    return { image, rectify: { ...measured, scope: "page", reason: "rectified", size, pageToPhoto: homographyFromQuad(page, corners) } };
  } catch {
    return { image: photo, rectify: { ...base, reason: "error" } };
  }
}

/**
 * Word boxes from Tesseract are normalised to the image it read: the rectified page (when scope is "page"),
 * deskewed by the clean-up. Map them back onto the photo as uploaded, so an overlay drawn on the original lands on
 * the words: undo the deskew rotation, then page → photo through the homography; each box becomes the bounding box
 * of its four mapped corners. Words from a raw (unprepared) read are already in photo coordinates.
 */
export function wordsToOriginal(words: OcrWord[], prep: OcrPrep): OcrWord[] {
  const r = prep.rectify;
  if (!prep.preprocessed || !r) return words;
  const pre = r.scope === "page" && r.size ? { w: r.size.w, h: r.size.h } : { w: r.photo.width, h: r.photo.height };
  const rad = ((prep.skewDeg ?? 0) * Math.PI) / 180;
  const [cos, sin] = [Math.cos(rad), Math.sin(rad)];
  const [cx, cy] = [pre.w / 2, pre.h / 2];
  const toPhoto = (nx: number, ny: number): Pt => {
    // Deskewed output = the pre-deskew image rotated by −skew about its centre (deskewAndScale); the 2× scale
    // cancels out in normalised coordinates. Rotating by +skew recovers the pre-deskew point.
    const [dx, dy] = [nx * pre.w - cx, ny * pre.h - cy];
    const p = { x: dx * cos - dy * sin + cx, y: dx * sin + dy * cos + cy };
    return r.scope === "page" && r.pageToPhoto ? applyH(r.pageToPhoto, p) : p;
  };
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  return words.map((w) => {
    const { x, y, w: bw, h: bh } = w.bbox;
    const pts = [toPhoto(x, y), toPhoto(x + bw, y), toPhoto(x + bw, y + bh), toPhoto(x, y + bh)];
    const x0 = clamp(Math.min(...pts.map((p) => p.x)) / r.photo.width);
    const y0 = clamp(Math.min(...pts.map((p) => p.y)) / r.photo.height);
    const x1 = clamp(Math.max(...pts.map((p) => p.x)) / r.photo.width);
    const y1 = clamp(Math.max(...pts.map((p) => p.y)) / r.photo.height);
    return { ...w, bbox: { ...w.bbox, x: x0, y: y0, w: x1 - x0, h: y1 - y0 } };
  });
}

export type OcrWord = { text: string; confidence: number; bbox: BoundingBox };

export function decodeToRgba(image: Buffer, mime: string): RgbaImage {
  if (mime === "image/png") {
    const png = PNG.sync.read(image);
    return { data: png.data, width: png.width, height: png.height };
  }
  if (mime === "image/jpeg") {
    const j = jpeg.decode(image, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 1024 });
    return { data: j.data, width: j.width, height: j.height };
  }
  throw new Error(`Cannot decode ${mime} for preprocessing`);
}

/** Binary-safe PGM (P5) encoding; Tesseract's Leptonica reads it directly, and it costs nothing to write. */
export function encodePgm(img: GrayImage): Buffer {
  const header = Buffer.from(`P5\n${img.width} ${img.height}\n255\n`, "ascii");
  return Buffer.concat([header, Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength)]);
}

/**
 * Clean up an upload for OCR. Never throws: on any problem it returns the raw image and says why.
 * `rectify` (D-50): true = detect the page and warp it flat first (subject to the flat-scan guard); false = record
 * that it is switched off; omitted = no rectification step at all (the benchmarks, byte-identical to before D-50).
 */
export function prepareForOcr(image: Buffer, mime: string, opts: { mode: Exclude<PrepMode, "off">; psm: Psm; rectify?: boolean }): { image: Buffer; prep: OcrPrep } {
  let rectify: OcrRectify | undefined;
  // A raw fallback reads the photo as uploaded, so whatever rectification found, the scope is the full frame.
  const raw = (warning: string): { image: Buffer; prep: OcrPrep } => ({
    image,
    prep: {
      preprocessed: false,
      skewDeg: null,
      threshold: null,
      method: null,
      inkRatio: null,
      psm: opts.psm,
      warning,
      ...(opts.rectify !== undefined
        ? {
            rectify: rectify
              ? { ...rectify, scope: "full-frame", reason: rectify.reason === "rectified" ? "prep-fallback" : rectify.reason, size: null, pageToPhoto: null }
              : null,
          }
        : {}),
    },
  });
  const psm = opts.psm;
  try {
    let input = decodeToRgba(image, mime);
    if (opts.rectify !== undefined) {
      const r = rectifyForOcr(input, opts.rectify);
      input = r.image;
      rectify = r.rectify;
    }
    const out = preprocess(input, { binarize: opts.mode === "binary" });
    if (out.inkRatio < MIN_INK_RATIO || out.inkRatio > MAX_INK_RATIO) {
      return raw(`Preprocessing produced a degenerate image (${(out.inkRatio * 100).toFixed(1)} % ink); OCR ran on the original.`);
    }
    return {
      image: encodePgm(out),
      prep: { preprocessed: true, skewDeg: out.skewDeg, threshold: out.threshold, method: out.method, inkRatio: Number(out.inkRatio.toFixed(4)), psm, ...(rectify ? { rectify } : {}) },
    };
  } catch (err) {
    return raw(`Preprocessing failed (${err instanceof Error ? err.message : "unknown error"}); OCR ran on the original.`);
  }
}

type TessBbox = { x0: number; y0: number; x1: number; y1: number };
type TessBlocks = { paragraphs?: { lines?: { words?: { text: string; confidence: number; bbox: TessBbox }[] }[] }[] }[] | null | undefined;

/** Flatten tesseract.js blocks into words with boxes normalised to the OCR'd image (0–1). */
export function wordsFromBlocks(blocks: TessBlocks, width: number, height: number): OcrWord[] {
  const out: OcrWord[] = [];
  for (const b of blocks ?? [])
    for (const p of b.paragraphs ?? [])
      for (const l of p.lines ?? [])
        for (const w of l.words ?? []) {
          if (!w.text.trim()) continue;
          const clamp = (v: number) => Math.max(0, Math.min(1, v));
          out.push({
            text: w.text,
            confidence: Math.round(Math.max(0, Math.min(100, w.confidence))) / 100,
            bbox: { field: "word", x: clamp(w.bbox.x0 / width), y: clamp(w.bbox.y0 / height), w: clamp((w.bbox.x1 - w.bbox.x0) / width), h: clamp((w.bbox.y1 - w.bbox.y0) / height), page: 1 },
          });
        }
  return out;
}

/** Image size from a PGM/PNG/JPEG buffer header, for normalising word boxes. */
export function imageSize(image: Buffer, mime: string, prepared: boolean): { width: number; height: number } {
  if (prepared) {
    const m = /^P5\s+(\d+)\s+(\d+)/.exec(image.subarray(0, 32).toString("ascii"));
    if (m) return { width: Number(m[1]), height: Number(m[2]) };
  }
  if (mime === "image/png") return { width: image.readUInt32BE(16), height: image.readUInt32BE(20) };
  const d = decodeToRgba(image, mime);
  return { width: d.width, height: d.height };
}

/** The claim page's inline hint when OCR read the full frame (D-50); null when it read a rectified page or no record. */
export function rectifyHint(r: Pick<OcrRectify, "scope" | "reason"> | null | undefined): string | null {
  if (!r || r.scope !== "full-frame") return null;
  switch (r.reason) {
    case "no-page":
      return "Page edges not found in this photo, so OCR read the full frame without perspective correction.";
    case "flat-scan":
      // Also what a page on a light surface looks like to the detector: no edge separates page from background.
      return "No page edges inside the frame (a flat scan, or a page on a light surface), so OCR read it as uploaded without perspective correction.";
    case "disabled":
      return "Perspective correction is switched off (OCR_RECTIFY=off), so OCR read the full frame.";
    default:
      return "Perspective correction could not run on this upload, so OCR read the full frame.";
  }
}
