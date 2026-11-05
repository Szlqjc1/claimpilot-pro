import { prisma } from "@/lib/db";

// Alert precision by rule (D-39): how often reviewers say a rule was wrong. Aggregated by rule only, never by
// reviewer. This measures PRECISION of the alerts that were raised; it says nothing about recall (errors no rule
// flagged never reach a reviewer), which would need a random audit sample of auto-approved claims.

export type PrecisionRow = {
  ruleId: string;
  anomalyType: string;
  /** Every exception the rule raised, including ones still Open. */
  alerts: number;
  /** Reviewer said "not an exception". */
  dismissed: number;
  /** Reviewer confirmed it was real: Resolved (corrected) + Waived (accepted). */
  confirmed: number;
  open: number;
  /** dismissed / (dismissed + confirmed); null until at least one alert has been decided. */
  dismissalRate: number | null;
};

export function precisionRows(groups: { ruleId: string; anomalyType: string; status: string; count: number }[]): PrecisionRow[] {
  const byRule = new Map<string, PrecisionRow>();
  for (const g of groups) {
    const row = byRule.get(g.ruleId) ?? { ruleId: g.ruleId, anomalyType: g.anomalyType, alerts: 0, dismissed: 0, confirmed: 0, open: 0, dismissalRate: null };
    row.alerts += g.count;
    if (g.status === "Dismissed") row.dismissed += g.count;
    else if (g.status === "Resolved" || g.status === "Waived") row.confirmed += g.count;
    else row.open += g.count;
    byRule.set(g.ruleId, row);
  }
  return [...byRule.values()]
    .map((r) => ({ ...r, dismissalRate: r.dismissed + r.confirmed > 0 ? r.dismissed / (r.dismissed + r.confirmed) : null }))
    .sort((a, b) => (a.ruleId < b.ruleId ? -1 : 1));
}

export async function alertPrecision(): Promise<PrecisionRow[]> {
  const groups = await prisma.exception.groupBy({ by: ["ruleId", "anomalyType", "status"], _count: { _all: true } });
  return precisionRows(groups.map((g) => ({ ruleId: g.ruleId, anomalyType: g.anomalyType, status: g.status, count: g._count._all })));
}
