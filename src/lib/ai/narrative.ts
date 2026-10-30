import { formatUsd } from "@/lib/domain/money";
import type { RiskResult } from "@/lib/risk/types";

/** Deterministic narrative used in mock mode and as the fallback when the LLM narrative fails. */
export function templateNarrative(result: RiskResult, ctx: { claimId: string; vendorName: string; amountCents: number }): string {
  if (result.findings.length === 0) {
    return `${ctx.claimId}: ${ctx.vendorName} invoice for ${formatUsd(ctx.amountCents)} reconciled against the SAP PO, goods receipt, project code and category policy. No exceptions raised; eligible for auto-approval.`;
  }
  const top = [...result.findings].sort((a, b) => b.points - a.points);
  const lead = top
    .slice(0, 3)
    .map((f) => `${f.anomalyType} (${f.ruleId}, +${f.points})`)
    .join("; ");
  return `${ctx.claimId}: ${result.findings.length} finding(s) totalling a risk score of ${result.score}/100 (${result.riskLevel}). Main drivers: ${lead}. Decision: ${result.decision.replace("_", " ").toLowerCase()} — reviewer should verify the evidence listed for each rule before releasing payment.`;
}
