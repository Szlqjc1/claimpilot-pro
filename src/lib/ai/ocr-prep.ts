import jpeg from "jpeg-js";
import { PNG } from "pngjs";
import type { BoundingBox } from "@/lib/domain/schemas";
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
};

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

/** Clean up an upload for OCR. Never throws: on any problem it returns the raw image and says why. */
export function prepareForOcr(image: Buffer, mime: string, opts: { mode: Exclude<PrepMode, "off">; psm: Psm }): { image: Buffer; prep: OcrPrep } {
  const raw = (warning: string) => ({ image, prep: { preprocessed: false, skewDeg: null, threshold: null, method: null, inkRatio: null, psm: opts.psm, warning } });
  const psm = opts.psm;
  try {
    const out = preprocess(decodeToRgba(image, mime), { binarize: opts.mode === "binary" });
    if (out.inkRatio < MIN_INK_RATIO || out.inkRatio > MAX_INK_RATIO) {
      return raw(`Preprocessing produced a degenerate image (${(out.inkRatio * 100).toFixed(1)} % ink); OCR ran on the original.`);
    }
    return { image: encodePgm(out), prep: { preprocessed: true, skewDeg: out.skewDeg, threshold: out.threshold, method: out.method, inkRatio: Number(out.inkRatio.toFixed(4)), psm } };
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
