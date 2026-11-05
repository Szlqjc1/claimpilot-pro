// Where an OCR confidence number came from (D-25, D-37). Seeded claims always use the demo fixture's OCR layer,
// whose per-field numbers are simulated (sha256(claimId:field) mapped into [0.93, 0.995], plus planted lowOcr
// samples); uploads use Tesseract's page-level confidence. The UI must say which, wherever a number is shown.

export type OcrSource = "fixture" | "tesseract";

/** run-audit.ts uses the fixture OCR exactly when the claim is seeded, Tesseract otherwise. */
export function ocrSourceOf(claimSource: string | null | undefined): OcrSource {
  return claimSource === "seed" ? "fixture" : "tesseract";
}

export const OCR_SOURCE_LABEL: Record<OcrSource, { short: string; title: string }> = {
  fixture: { short: "OCR: fixture (simulated)", title: "Simulated OCR confidence (demo fixture) — not a measurement" },
  tesseract: { short: "OCR: Tesseract", title: "Tesseract page-level confidence" },
};
