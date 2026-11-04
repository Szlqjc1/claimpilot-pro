export type AuditTone = "red" | "green" | "amber" | "neutral";

/** Badge tone for an audit-log action. Pure, so the /audit table and its tests share one mapping. */
export function auditActionTone(action: string): AuditTone {
  if (action.includes("Flagged")) return "red";
  if (action.includes("Validated") || action.includes("Posted")) return "green";
  if (action.includes("Failed")) return "amber";
  if (action.includes("Resolved") || action.includes("Waived")) return "amber";
  return "neutral";
}

/** `initiatedBy` from an audit row's metadata JSON, or null when absent or unparsable. */
export function initiatedByOf(metadata: string | null): string | null {
  try {
    const v = (JSON.parse(metadata ?? "{}") as { initiatedBy?: unknown }).initiatedBy;
    return typeof v === "string" && v ? v : null;
  } catch {
    return null;
  }
}
