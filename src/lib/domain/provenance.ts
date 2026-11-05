/** D-37: which extraction a claim was scored on. Only non-reference sources get a chip; null/fixture show nothing. */
export function provenanceLabel(source: string | null | undefined): { label: string; title: string } | null {
  if (source === "model") return { label: "Model extraction", title: "Scored on the live model's extraction (upload, no reference available); grounding-checked against the OCR text" };
  if (source === "fallback") return { label: "Fallback", title: "The live model failed; scored on the reference extraction" };
  return null;
}
