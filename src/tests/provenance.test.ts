import { describe, expect, it } from "vitest";
import { provenanceLabel } from "@/lib/domain/provenance";

// D-37 / Q5: only non-reference extractions get a chip, so mock and live-shadow claims look the same.
describe("provenanceLabel", () => {
  it.each([
    ["model", "Model extraction"],
    ["fallback", "Fallback"],
    ["fixture", null],
    [null, null],
  ] as const)("%s → %s", (source, label) => {
    expect(provenanceLabel(source)?.label ?? null).toBe(label);
  });
});
