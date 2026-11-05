import "server-only";
import { fixtureSchema, type BoundingBox, type ReceiptFixture } from "@/lib/domain/schemas";
import { readReceiptFile } from "@/lib/receipts/storage";
import { OCR_PIPELINE, imageSize, prepareForOcr, wordsFromBlocks, type OcrPrep, type OcrWord } from "./ocr-prep";

// OCR adapter. Seeded claims use deterministic fixtures generated with the receipt;
// uploads use Tesseract.js when OCR_MODE=tesseract.

export type OcrResult = {
  text: string;
  confidence: number;
  boxes: BoundingBox[];
  source: "fixture" | "tesseract";
  /** Tesseract only (Task 7b B5): word-level text, confidence and boxes. Data only; nothing scores on it. */
  words?: OcrWord[];
  /** Tesseract only (Task 7b B2): what preprocessing ran, its skew estimate, the PSM, and any fallback warning. */
  prep?: OcrPrep;
};

export async function loadFixture(claimId: string): Promise<ReceiptFixture | null> {
  const raw = await readReceiptFile(claimId, "fixture.json");
  if (!raw) return null;
  const parsed = fixtureSchema.safeParse(JSON.parse(raw.toString("utf8")));
  return parsed.success ? parsed.data : null;
}

export function ocrFromFixture(f: ReceiptFixture): OcrResult {
  return { text: f.ocrText, confidence: f.ocrConfidence, boxes: f.boxes, source: "fixture" };
}

/**
 * Uploads: optional clean-up (OCR_PIPELINE, chosen by docs/GROUNDING_BENCH.md), then Tesseract. Preprocessing never
 * fails an upload: on any problem it falls back to the original image and records a warning in `prep`.
 */
export async function ocrWithTesseract(image: Buffer, mime = "image/png"): Promise<OcrResult> {
  let input = image;
  let prep: OcrPrep = { preprocessed: false, skewDeg: null, threshold: null, method: null, inkRatio: null, psm: OCR_PIPELINE.psm };
  if (OCR_PIPELINE.mode !== "off") ({ image: input, prep } = prepareForOcr(image, mime, { mode: OCR_PIPELINE.mode, psm: OCR_PIPELINE.psm }));
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng");
  try {
    if (OCR_PIPELINE.psm !== "default") await worker.setParameters({ tessedit_pageseg_mode: OCR_PIPELINE.psm as never });
    const { data } = await worker.recognize(input, {}, { text: true, blocks: true });
    let words: OcrWord[] = [];
    try {
      const size = imageSize(input, mime, prep.preprocessed);
      words = wordsFromBlocks(data.blocks as never, size.width, size.height);
    } catch {
      // Word capture is data only; never fail the OCR over it.
    }
    // Word geometry is not mapped to invoice fields, so no field boxes are claimed.
    return { text: data.text, confidence: Math.max(0, Math.min(1, (data.confidence ?? 0) / 100)), boxes: [], source: "tesseract", words, prep };
  } finally {
    await worker.terminate();
  }
}
