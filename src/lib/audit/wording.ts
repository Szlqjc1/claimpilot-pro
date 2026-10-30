import {
  AUDIT_ACTION_FLAGGED,
  AUDIT_ACTION_VALIDATED,
  AUDIT_ACTOR,
  AUDIT_DETAILS_VALIDATED,
  ROUTING,
  type Department,
} from "@/lib/domain/constants";
import type { Finding } from "@/lib/risk/types";

/** The audit-log entry for an AI-RPA run. The clean-path string is only ever written with zero findings. */
export function auditEntryFor(findings: Finding[], department: string): { actor: string; action: string; details: string } {
  if (findings.length === 0) {
    return { actor: AUDIT_ACTOR, action: AUDIT_ACTION_VALIDATED, details: AUDIT_DETAILS_VALIDATED };
  }
  const list = findings.map((f) => `${f.anomalyType} (${f.riskLevel})`).join(", ");
  const routedTo = ROUTING[department as Department] ?? "Accounts Payable";
  return {
    actor: AUDIT_ACTOR,
    action: AUDIT_ACTION_FLAGGED,
    details: `AI-RPA raised ${findings.length} exception(s): ${list}. Routed to ${routedTo}.`,
  };
}
