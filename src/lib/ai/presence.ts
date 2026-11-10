// Field presence (Task 13 A2, D-44). Splits "no value" into "the document has no such field" (absent) and "there
// is one and we could not read it" (unreadable), and flags a field the document gives two different values for
// (conflict). Pure and deterministic; attached to the extraction before scoring, like fieldChecks (D-37).
import type { Extraction } from "@/lib/domain/schemas";
import type { FieldCheck } from "./grounding";
import { CRITICAL_FIELDS, labelExplicitlyEmpty, labelIsWhole, labelPresent, type CriticalField } from "./labels";
import type { OcrWord } from "./ocr-prep";

export type PresenceState = "present" | "absent" | "unreadable" | "conflict";
export type GroundingResult = FieldCheck;
export interface FieldPresence {
  field: CriticalField;
  state: PresenceState;
  labelSeen: boolean;
}

/** Normalised for comparing candidates: a number compares in cents, anything else as its letters and digits. */
function normaliseCandidate(v: string): string {
  const money = v.replace(/[$,\s]/g, "");
  if (/^-?\d+(\.\d+)?$/.test(money)) return `#${Math.round(Number(money) * 100)}`;
  return v.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

const isBlank = (v: string | null | undefined) => v === null || v === undefined || v.trim() === "";

export function classifyPresence(input: { field: CriticalField; value: string | null; grounding: GroundingResult; text: string; candidateValues?: string[] }): FieldPresence {
  const labelSeen = labelPresent(input.field, input.text);
  const at = (state: PresenceState): FieldPresence => ({ field: input.field, state, labelSeen });
  const distinct = new Set((input.candidateValues ?? []).filter((v) => !isBlank(v)).map(normaliseCandidate));
  if (distinct.size >= 2) return at("conflict");
  if (!isBlank(input.value)) return at(input.grounding === "found" ? "present" : "unreadable");
  // A label followed only by an empty marker ("PO Number: —") is the document saying it has none: absent.
  return at(labelSeen && !labelExplicitlyEmpty(input.field, input.text) ? "unreadable" : "absent");
}

/** The value of a critical field as a string (vendor name, money as a plain decimal), or null. */
export function criticalValue(extraction: Extraction, field: CriticalField): string | null {
  if (field === "vendorName") return extraction.vendor?.name ?? null;
  const v = extraction[field];
  return v === null || v === undefined ? null : String(v);
}

// ── Distant-anchor rejection (Task 16 B, D-55) ────────────────────────────────────────────────────────────────
// The model reports `fieldCandidates` when it sees two different values for one field, and two distinct candidates
// make a `conflict` (→ R-19). A value that sits far from every label of its field (a reference number in a footer, a
// second document in the photo) is not a second reading of that field. Using the OCR word boxes, a candidate is kept
// only if some occurrence of it lies within ANCHOR_MAX_LINES line heights of some occurrence of the field's label.

/** A candidate further than this many line heights (median word height) from every label of its field is dropped. */
export const ANCHOR_MAX_LINES = 3;
/** Page size assumed when the caller has no image size: A4 portrait, so normalised boxes keep their aspect. */
const DEFAULT_PAGE = { width: 1000, height: 1414 };
const MAX_LABEL_WORDS = 4;
const MAX_VALUE_WORDS = 6;

type PxBox = { x0: number; y0: number; x1: number; y1: number };
export type AnchorGeometry = { words: OcrWord[]; size?: { width: number; height: number } | null };
export type AnchorResult = {
  kept: string[];
  /** Candidates dropped as too far from any label, with their distance in line heights. */
  dropped: { value: string; lines: number }[];
};

function union(ws: OcrWord[], W: number, H: number): PxBox {
  return {
    x0: Math.min(...ws.map((w) => w.bbox.x * W)),
    y0: Math.min(...ws.map((w) => w.bbox.y * H)),
    x1: Math.max(...ws.map((w) => (w.bbox.x + w.bbox.w) * W)),
    y1: Math.max(...ws.map((w) => (w.bbox.y + w.bbox.h) * H)),
  };
}

/** Every run of 1..max consecutive words for which `match` holds on the run's joined text, as a box. */
function runsWhere(words: OcrWord[], max: number, W: number, H: number, match: (joined: string) => boolean): PxBox[] {
  const out: PxBox[] = [];
  for (let i = 0; i < words.length; i++) {
    for (let k = 1; k <= max && i + k <= words.length; k++) {
      const run = words.slice(i, i + k);
      if (match(run.map((w) => w.text).join(" "))) {
        out.push(union(run, W, H));
        break; // the shortest run from this start
      }
    }
  }
  return out;
}

/** Gap between two boxes (0 if they overlap), in px. */
function gap(a: PxBox, b: PxBox): number {
  const dx = Math.max(0, a.x0 - b.x1, b.x0 - a.x1);
  const dy = Math.max(0, a.y0 - b.y1, b.y0 - a.y1);
  return Math.hypot(dx, dy);
}

/**
 * Drop the candidates of one field that sit more than ANCHOR_MAX_LINES line heights from every occurrence of the
 * field's label. Conservative: without word boxes, without a located label, or for a candidate that cannot be found
 * among the words, nothing is dropped (the conflict stands and a human looks).
 */
export function anchorCandidates(field: CriticalField, candidates: string[], geometry: AnchorGeometry | null | undefined): AnchorResult {
  const all = candidates.filter((v) => !isBlank(v));
  const words = geometry?.words?.filter((w) => w.text.trim() && w.bbox.h > 0) ?? [];
  if (all.length < 2 || words.length === 0) return { kept: all, dropped: [] };
  const { width: W, height: H } = geometry?.size ?? DEFAULT_PAGE;
  const heights = words.map((w) => w.bbox.h * H).sort((a, b) => a - b);
  const lineH = heights[Math.floor(heights.length / 2)];
  const labels = runsWhere(words, MAX_LABEL_WORDS, W, H, (t) => labelIsWhole(field, t));
  if (labels.length === 0 || lineH <= 0) return { kept: all, dropped: [] };
  const kept: string[] = [];
  const dropped: AnchorResult["dropped"] = [];
  for (const v of all) {
    const target = normaliseCandidate(v);
    const at = runsWhere(words, MAX_VALUE_WORDS, W, H, (t) => normaliseCandidate(t) === target);
    if (at.length === 0) {
      kept.push(v);
      continue;
    }
    const lines = Math.min(...at.flatMap((b) => labels.map((l) => gap(b, l)))) / lineH;
    if (lines <= ANCHOR_MAX_LINES) kept.push(v);
    else dropped.push({ value: v, lines: Math.round(lines * 10) / 10 });
  }
  return { kept, dropped };
}

/**
 * Presence of every critical field. `fieldChecks` must already be attached (groundExtraction). With OCR word boxes
 * (`runDetail.ocrWords`), candidates far from their label are dropped before the conflict test (D-55).
 */
export function presenceOf(extraction: Extraction, ocrText: string, geometry?: AnchorGeometry | null): Record<CriticalField, FieldPresence> {
  return Object.fromEntries(
    CRITICAL_FIELDS.map((field) => {
      const raw = extraction.fieldCandidates?.[field];
      return [
        field,
        classifyPresence({
          field,
          value: criticalValue(extraction, field),
          grounding: (extraction.fieldChecks?.[field] as FieldCheck | undefined) ?? "not_extracted",
          text: ocrText,
          candidateValues: raw && geometry ? anchorCandidates(field, raw, geometry).kept : raw,
        }),
      ];
    }),
  ) as Record<CriticalField, FieldPresence>;
}
