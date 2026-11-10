// Model-free OCR metrics (D-52, D-53). Everything here is deterministic and calls no model: it scores OCR text
// against what the renderer drew, and asks the real rule code whether the system would notice what it could not read.
import { groundExtraction } from "@/lib/ai/grounding";
import { presenceOf } from "@/lib/ai/presence";
import { evaluateRisk } from "@/lib/risk/score";
import type { RiskInput } from "@/lib/risk/types";
import { BENCH_FIELDS } from "./variants";

/** Levenshtein distance (two-row DP). O(n·m) time, O(m) memory; fine for page-sized strings. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Uint32Array(b.length + 1);
  let cur = new Uint32Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      const sub = prev[j - 1] + (ca === b.charCodeAt(j - 1) ? 0 : 1);
      cur[j] = Math.min(sub, prev[j] + 1, cur[j - 1] + 1);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

/** Whitespace-separated tokens, sorted, joined by single spaces. */
const sortedTokens = (s: string) => s.split(/\s+/).filter(Boolean).sort().join(" ");

/**
 * Character error rate = edit distance / reference length, computed on the SORTED TOKENS of both texts.
 * Sorting makes the rate insensitive to reading order (Tesseract may read a two-column header column by column), so
 * it measures misread characters, not layout analysis. Dropped text counts in full (every missing character is an
 * error); invented text counts too. Can exceed 1 when the OCR adds more than the reference holds.
 */
export function cer(ocrText: string, reference: string): number {
  const ref = sortedTokens(reference);
  return ref.length ? editDistance(sortedTokens(ocrText), ref) / ref.length : 0;
}

/**
 * How many of the known critical values the existing matchers find in the OCR text (grounding's own `found`), out
 * of those the reference actually has (a travel invoice has no PO).
 */
export function criticalHits(input: RiskInput, ocrText: string): { hits: number; known: number } {
  const checks = groundExtraction(input.extraction, ocrText);
  const known = BENCH_FIELDS.filter((f) => checks[f] !== "not_extracted");
  return { hits: known.filter((f) => checks[f] === "found").length, known: known.length };
}

/**
 * The safety question, without a model: substitute the KNOWN-GOOD extraction for the model's, attach grounding and
 * presence against the OCR text exactly as run-audit does (OCR page confidence as field confidence, as for an
 * upload), and run the real rules. Does the system notice it could not verify the page?
 */
export function knownGoodRisk(input: RiskInput, ocrText: string, ocrConfidence: number) {
  const conf = Object.fromEntries(BENCH_FIELDS.map((f) => [f, ocrConfidence]));
  let e = { ...input.extraction, fieldConfidence: { ...input.extraction.fieldConfidence, ...conf } };
  e = { ...e, fieldChecks: groundExtraction(e, ocrText) };
  e = { ...e, fieldPresence: presenceOf(e, ocrText) };
  const result = evaluateRisk({ ...input, extraction: e });
  const has = (id: string) => result.findings.some((f) => f.ruleId === id);
  return { r14: has("R-14"), r19: has("R-19"), decision: result.decision, rules: result.findings.map((f) => f.ruleId) };
}
