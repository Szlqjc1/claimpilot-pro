import type { Extraction } from "@/lib/domain/schemas";
import { GROUNDED_FIELDS, type GroundedField } from "@/lib/ai/grounding";
import { normalizeVendorName } from "@/lib/risk/rules";

// Field-level diff between the reference (fixture) extraction and the model's shadow extraction (D-37).
// Values are compared after normalisation so a casing or separator change is not reported as a disagreement.

export type ExtractionDiff = Record<GroundedField, { reference: unknown; model: unknown; match: boolean }>;

const valueOf = (e: Extraction, f: GroundedField): unknown => (f === "vendorName" ? e.vendor?.name : (e as unknown as Record<string, unknown>)[f]) ?? null;

function normalise(f: GroundedField, v: unknown): unknown {
  if (v === null || v === undefined || v === "") return null;
  if (f === "vendorName") return normalizeVendorName(String(v));
  if (typeof v === "number") return Math.round(v * 100);
  if (f === "subtotal" || f === "salesTax" || f === "total") return Math.round(Number(v) * 100);
  return String(v).toUpperCase().replace(/[\s\-/.]/g, "");
}

export function diffExtractions(reference: Extraction, model: Extraction): ExtractionDiff {
  return Object.fromEntries(
    GROUNDED_FIELDS.map((f) => {
      const r = valueOf(reference, f);
      const m = valueOf(model, f);
      return [f, { reference: r, model: m, match: normalise(f, r) === normalise(f, m) }];
    }),
  ) as ExtractionDiff;
}
