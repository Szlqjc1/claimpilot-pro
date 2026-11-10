import { describe, expect, it } from "vitest";
import { buildSeedPlan, seedRiskInput } from "@/lib/seed/run";
import { evaluateRisk } from "@/lib/risk/score";
import { groundExtraction } from "@/lib/ai/grounding";
import { labelIsWhole } from "@/lib/ai/labels";
import { ANCHOR_MAX_LINES, anchorCandidates, classifyPresence, presenceOf, type AnchorGeometry } from "@/lib/ai/presence";
import type { OcrWord } from "@/lib/ai/ocr-prep";

// Distant-anchor rejection (Task 16 B, DECISIONS D-55): a candidate value more than three line heights from every
// label of its field is not a second reading of that field, so it cannot make a conflict.

const PAGE = { width: 1000, height: 1400 };
const LINE_H = 20;

/** One OCR word at (x, y) px on PAGE, 10 px per character, LINE_H tall, as normalised boxes like Tesseract's. */
function word(text: string, x: number, y: number): OcrWord {
  return { text, confidence: 0.95, bbox: { field: "word", x: x / PAGE.width, y: y / PAGE.height, w: (text.length * 10) / PAGE.width, h: LINE_H / PAGE.height, page: 1 } };
}
/** A line of words starting at (x, y), one space (10 px) between words. */
function line(text: string, x: number, y: number): OcrWord[] {
  const out: OcrWord[] = [];
  for (const t of text.split(" ")) {
    out.push(word(t, x, y));
    x += (t.length + 1) * 10;
  }
  return out;
}
const geo = (...lines: OcrWord[][]): AnchorGeometry => ({ words: lines.flat(), size: PAGE });

describe("labelIsWhole", () => {
  it("matches a label run exactly, give or take trailing punctuation, and nothing longer", () => {
    expect(labelIsWhole("invoiceNumber", "Invoice No.:")).toBe(true);
    expect(labelIsWhole("poNumber", "PO Number")).toBe(true);
    expect(labelIsWhole("total", "Total")).toBe(true);
    expect(labelIsWhole("total", "Subtotal")).toBe(false);
    expect(labelIsWhole("invoiceNumber", "Invoice No. TVR-118")).toBe(false);
  });
});

describe("anchorCandidates (D-55)", () => {
  it("two candidates, each next to a label of the field → both kept → conflict", () => {
    const g = geo(line("Invoice No.: TVR-118", 50, 100), line("Invoice No.: TVR-181", 50, 400));
    const r = anchorCandidates("invoiceNumber", ["TVR-118", "TVR-181"], g);
    expect(r).toEqual({ kept: ["TVR-118", "TVR-181"], dropped: [] });
    expect(classifyPresence({ field: "invoiceNumber", value: "TVR-118", grounding: "found", text: "Invoice No.: TVR-118", candidateValues: r.kept }).state).toBe("conflict");
  });

  it("a candidate under its label within three lines is still near (label-above layouts)", () => {
    const g = geo(line("Invoice No.", 50, 100), line("TVR-118", 50, 125), line("TVR-181", 50, 100 + 3 * LINE_H + 10));
    expect(anchorCandidates("invoiceNumber", ["TVR-118", "TVR-181"], g).kept).toEqual(["TVR-118", "TVR-181"]);
  });

  it("one candidate near its label and one 900 px away → the far one dropped, no conflict", () => {
    const g = geo(line("Invoice No.: TVR-118", 50, 100), line("Ref TVR-181", 50, 1000));
    const r = anchorCandidates("invoiceNumber", ["TVR-118", "TVR-181"], g);
    expect(r.kept).toEqual(["TVR-118"]);
    expect(r.dropped).toHaveLength(1);
    expect(r.dropped[0].value).toBe("TVR-181");
    expect(r.dropped[0].lines).toBeGreaterThan(ANCHOR_MAX_LINES);
    expect(r.dropped[0].lines).toBeCloseTo((1000 - 120) / LINE_H, 0); // 880 px gap / 20 px lines
    expect(classifyPresence({ field: "invoiceNumber", value: "TVR-118", grounding: "found", text: "Invoice No.: TVR-118", candidateValues: r.kept }).state).toBe("present");
  });

  it("money candidates compare in cents, so a far '$15,400.00' is located and dropped", () => {
    const g = geo(line("Total $14,500.00", 600, 900), line("Previous balance $15,400.00", 50, 100));
    expect(anchorCandidates("total", ["14500.00", "15400.00"], g)).toMatchObject({ kept: ["14500.00"], dropped: [{ value: "15400.00" }] });
  });

  it("conservative: no word boxes, no label found, or a candidate not among the words → nothing dropped", () => {
    expect(anchorCandidates("invoiceNumber", ["TVR-118", "TVR-181"], null).kept).toEqual(["TVR-118", "TVR-181"]);
    expect(anchorCandidates("invoiceNumber", ["TVR-118", "TVR-181"], geo(line("TVR-118", 50, 100), line("TVR-181", 50, 1000))).kept).toEqual(["TVR-118", "TVR-181"]);
    expect(anchorCandidates("invoiceNumber", ["TVR-118", "TVR-999"], geo(line("Invoice No.: TVR-118", 50, 100))).kept).toEqual(["TVR-118", "TVR-999"]);
  });
});

describe("presenceOf with word boxes: R-19 and the seeded claims", () => {
  const plan = buildSeedPlan();
  /** The fixture's OCR text as word boxes: one text line per 30 px, as Tesseract would report a clean page. */
  const wordsOf = (text: string) => text.split("\n").flatMap((l, i) => (l.trim() ? line(l.trim().replace(/\s+/g, " "), 40, 40 + i * 30) : []));

  it("a far second value no longer raises R-19; without word boxes it still does", () => {
    const c = plan.claims.find((x) => x.claimId === "CLM-2026-0142")!;
    const input = seedRiskInput(plan, c);
    const inv = input.extraction.invoiceNumber!;
    const text = `${plan.fixtures.get(c.claimId)!.fixture.ocrText}\nRemittance ref ${inv}9`;
    const e0 = { ...input.extraction, fieldCandidates: { invoiceNumber: [inv, `${inv}9`] } };
    const e = { ...e0, fieldChecks: groundExtraction(e0, text) };
    const lines = text.split("\n");
    const words = [...wordsOf(lines.slice(0, -1).join("\n")), ...line(lines[lines.length - 1], 40, 1300)];
    const score = (geometry: AnchorGeometry | null) => evaluateRisk({ ...input, extraction: { ...e, fieldPresence: presenceOf(e, text, geometry) } });
    expect(presenceOf(e, text).invoiceNumber.state).toBe("conflict");
    expect(score(null).findings.map((f) => f.ruleId)).toContain("R-19");
    expect(presenceOf(e, text, { words, size: PAGE }).invoiceNumber.state).toBe("present");
    expect(score({ words, size: PAGE }).findings.map((f) => f.ruleId)).not.toContain("R-19");
  });

  it("every seeded claim: presence and risk are identical with and without word boxes", () => {
    for (const c of plan.claims) {
      const input = seedRiskInput(plan, c);
      const text = plan.fixtures.get(c.claimId)!.fixture.ocrText;
      const e = { ...input.extraction, fieldChecks: groundExtraction(input.extraction, text) };
      const without = presenceOf(e, text);
      const withBoxes = presenceOf(e, text, { words: wordsOf(text), size: PAGE });
      expect(withBoxes, c.claimId).toEqual(without);
      expect(evaluateRisk({ ...input, extraction: { ...e, fieldPresence: withBoxes } })).toEqual(evaluateRisk({ ...input, extraction: { ...e, fieldPresence: without } }));
    }
  });
});
