import { describe, expect, it } from "vitest";
import { chipFor } from "@/lib/domain/fields";
import { annotateReceipt } from "@/lib/ai/annotate";
import { loadFixture } from "@/lib/ai/ocr";

// D-37 / Q2: the chip shows the grounding state and the OCR layer's number; the model's number never appears.
describe("chipFor", () => {
  it.each([
    ["found", 0.96, "✓ found · OCR 0.96", "high"],
    ["found", 0.8, "✓ found · OCR 0.80", "medium"],
    ["found", 0.68, "✓ found · OCR 0.68", "low"],
    ["not_found", 0.96, "✗ not found · OCR 0.96", "low"],
    ["not_extracted", 0.9, "— not extracted", null],
  ] as const)("%s at %s → %s (%s)", (check, ocr, text, band) => {
    expect(chipFor(check, ocr)).toMatchObject({ text, band });
  });
});

describe("annotated invoice", () => {
  it("labels boxes with grounding + OCR confidence and uses the grounding legend", async () => {
    const f = (await loadFixture("CLM-2026-0144"))!;
    const svg = annotateReceipt({ data: Buffer.from("<svg/>"), mime: "image/svg+xml" }, f.extraction, f.ocrText);
    expect(svg).toContain("✓ found · OCR");
    expect(svg).toContain("In OCR text · OCR confidence");
    expect(svg).not.toContain(">OCR confidence<");
  });
});

describe("OCR source disclosure (D-25 / D-37)", () => {
  it("seeded claims are labelled as simulated fixture confidence, uploads as Tesseract page-level", async () => {
    const { ocrSourceOf, OCR_SOURCE_LABEL } = await import("@/lib/domain/ocr-source");
    expect(ocrSourceOf("seed")).toBe("fixture");
    expect(ocrSourceOf("upload")).toBe("tesseract");
    expect(OCR_SOURCE_LABEL.fixture).toEqual({ short: "OCR: fixture (simulated)", title: "Simulated OCR confidence (demo fixture) — not a measurement" });
    expect(OCR_SOURCE_LABEL.tesseract.title).toBe("Tesseract page-level confidence");
  });

  it("the annotated invoice image itself states where its numbers came from", async () => {
    const f = (await loadFixture("CLM-2026-0144"))!;
    const img = { data: Buffer.from("<svg/>"), mime: "image/svg+xml" };
    expect(annotateReceipt(img, f.extraction, f.ocrText, "fixture")).toContain("OCR numbers simulated (demo fixture), not measured");
    expect(annotateReceipt(img, f.extraction, f.ocrText, "tesseract")).toContain("Tesseract page-level confidence");
    expect(annotateReceipt(img, f.extraction, f.ocrText, "fixture")).not.toContain("AI-generated overlay — demo data");
  });
});
