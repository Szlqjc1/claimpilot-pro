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
