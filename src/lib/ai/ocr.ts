import "server-only";
import { fixtureSchema, type BoundingBox, type ReceiptFixture } from "@/lib/domain/schemas";
import { readReceiptFile } from "@/lib/receipts/storage";

// OCR adapter. Seeded claims use deterministic fixtures generated with the receipt;
// uploads use Tesseract.js when OCR_MODE=tesseract.

export type OcrResult = { text: string; confidence: number; boxes: BoundingBox[]; source: "fixture" | "tesseract" };

export async function loadFixture(claimId: string): Promise<ReceiptFixture | null> {
  const raw = await readReceiptFile(claimId, "fixture.json");
  if (!raw) return null;
  const parsed = fixtureSchema.safeParse(JSON.parse(raw.toString("utf8")));
  return parsed.success ? parsed.data : null;
}

export function ocrFromFixture(f: ReceiptFixture): OcrResult {
  return { text: f.ocrText, confidence: f.ocrConfidence, boxes: f.boxes, source: "fixture" };
}

export async function ocrWithTesseract(image: Buffer): Promise<OcrResult> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng");
  try {
    const { data } = await worker.recognize(image);
    // Word geometry is not mapped to invoice fields, so no field boxes are claimed.
    return { text: data.text, confidence: Math.max(0, Math.min(1, (data.confidence ?? 0) / 100)), boxes: [], source: "tesseract" };
  } finally {
    await worker.terminate();
  }
}
