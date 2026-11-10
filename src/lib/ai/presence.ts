// Field presence (Task 13 A2, D-44). Splits "no value" into "the document has no such field" (absent) and "there
// is one and we could not read it" (unreadable), and flags a field the document gives two different values for
// (conflict). Pure and deterministic; attached to the extraction before scoring, like fieldChecks (D-37).
import type { Extraction } from "@/lib/domain/schemas";
import type { FieldCheck } from "./grounding";
import { CRITICAL_FIELDS, labelExplicitlyEmpty, labelPresent, type CriticalField } from "./labels";

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

/** Presence of every critical field. `fieldChecks` must already be attached (groundExtraction). */
export function presenceOf(extraction: Extraction, ocrText: string): Record<CriticalField, FieldPresence> {
  return Object.fromEntries(
    CRITICAL_FIELDS.map((field) => [
      field,
      classifyPresence({
        field,
        value: criticalValue(extraction, field),
        grounding: (extraction.fieldChecks?.[field] as FieldCheck | undefined) ?? "not_extracted",
        text: ocrText,
        candidateValues: extraction.fieldCandidates?.[field],
      }),
    ]),
  ) as Record<CriticalField, FieldPresence>;
}
