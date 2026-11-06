import { CATEGORIES, DEPARTMENTS, type AnomalyType } from "@/lib/domain/constants";

// Pure KPI formulas over plain rows. Every dashboard number comes through here.

export type KpiClaim = {
  claimId: string;
  amountCents: number;
  status: string;
  decision: string | null;
  riskLevel: string | null;
  submittedAt: Date;
  analyzedAt: Date | null;
  department: string;
  category: string;
  projectCode: string | null;
  vendorName: string;
  exceptions: { anomalyType: string; status: string; riskLevel: string }[];
  lineItems: { partNumber: string | null; unitPrice: number; amount: number }[];
  /** For spend by site (D-43); optional so KPI fixtures need not set them. */
  employee?: string;
  shipToPlant?: string | null;
};

export type KpiBenchmark = { itemCode: string; p50Cents: number };
export type KpiProject = { code: string; name: string; budgetCents: number };

export type KpiValues = {
  totalSpendCents: number;
  claimsInScope: number;
  analyzedCount: number;
  autoClearRate: number;
  exceptionRate: number;
  openExceptionClaims: number;
  highRiskExposureCents: number;
  avgCycleHours: number;
  ocrStraightThroughRate: number;
  duplicateRecoveryCents: number;
  benchmarkVariance: number;
  budgetUtilization: number;
  highRiskRate: number;
};

const isReviewed = (c: KpiClaim) => c.status === "Analyzed" || c.status === "Posted";
const ratio = (num: number, den: number) => (den === 0 ? 0 : num / den);
const hasAnomaly = (c: KpiClaim, t: AnomalyType) => c.exceptions.some((e) => e.anomalyType === t);

export function computeKpis(claims: KpiClaim[], benchmarks: KpiBenchmark[], projects: KpiProject[]): KpiValues {
  const reviewed = claims.filter(isReviewed);
  const cycle = reviewed.filter((c) => c.analyzedAt);
  const cycleHours = cycle.reduce((s, c) => s + (c.analyzedAt!.getTime() - c.submittedAt.getTime()) / 3_600_000, 0);

  // Benchmark variance: weighted by line amount over matched line items.
  const p50 = new Map(benchmarks.map((b) => [b.itemCode, b.p50Cents]));
  let varNum = 0;
  let varDen = 0;
  for (const c of reviewed) {
    for (const li of c.lineItems) {
      const base = li.partNumber ? p50.get(li.partNumber) : undefined;
      if (!base) continue;
      const weight = Math.abs(li.amount);
      varNum += ((Math.round(li.unitPrice * 100) - base) / base) * weight;
      varDen += weight;
    }
  }

  const projectCodes = new Set(projects.map((p) => p.code));
  const projectSpend = claims.filter((c) => c.projectCode && projectCodes.has(c.projectCode)).reduce((s, c) => s + c.amountCents, 0);
  const budget = projects.reduce((s, p) => s + p.budgetCents, 0);

  return {
    totalSpendCents: claims.reduce((s, c) => s + c.amountCents, 0),
    claimsInScope: claims.length,
    analyzedCount: reviewed.length,
    autoClearRate: ratio(reviewed.filter((c) => c.decision === "AUTO_APPROVE").length, reviewed.length),
    exceptionRate: ratio(reviewed.filter((c) => c.exceptions.length > 0).length, reviewed.length),
    openExceptionClaims: reviewed.filter((c) => c.exceptions.some((e) => e.status === "Open")).length,
    highRiskExposureCents: claims.filter((c) => c.riskLevel === "High").reduce((s, c) => s + c.amountCents, 0),
    avgCycleHours: cycle.length === 0 ? 0 : cycleHours / cycle.length,
    ocrStraightThroughRate: ratio(reviewed.filter((c) => !hasAnomaly(c, "Low OCR Confidence")).length, reviewed.length),
    duplicateRecoveryCents: claims.filter((c) => hasAnomaly(c, "Duplicate Supplier Invoice")).reduce((s, c) => s + c.amountCents, 0),
    benchmarkVariance: ratio(varNum, varDen),
    budgetUtilization: ratio(projectSpend, budget),
    highRiskRate: ratio(reviewed.filter((c) => c.riskLevel === "High").length, reviewed.length),
  };
}

const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Last 12 calendar months ending with the month of `end`. */
export function monthlyTrend(claims: KpiClaim[], end: Date) {
  const months: { key: string; label: string }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - i, 1));
    months.push({ key: monthKey(d), label: `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}` });
  }
  const spend = new Map<string, number>();
  for (const c of claims) spend.set(monthKey(c.submittedAt), (spend.get(monthKey(c.submittedAt)) ?? 0) + c.amountCents);
  return months.map((m, i) => {
    const window = months.slice(Math.max(0, i - 2), i + 1).map((x) => spend.get(x.key) ?? 0);
    return {
      month: m.label,
      key: m.key,
      spend: (spend.get(m.key) ?? 0) / 100,
      trailingAvg: Math.round(window.reduce((a, b) => a + b, 0) / window.length) / 100,
    };
  });
}

export function categoryMix(claims: KpiClaim[]) {
  return CATEGORIES.map((category) => ({
    category,
    spend: claims.filter((c) => c.category === category).reduce((s, c) => s + c.amountCents, 0) / 100,
  }))
    .filter((r) => r.spend > 0)
    .sort((a, b) => b.spend - a.spend);
}

export function riskByDepartment(claims: KpiClaim[]) {
  return DEPARTMENTS.map((department) => {
    const rows = claims.filter((c) => c.department === department && c.riskLevel);
    return {
      department,
      High: rows.filter((c) => c.riskLevel === "High").length,
      Medium: rows.filter((c) => c.riskLevel === "Medium").length,
      Low: rows.filter((c) => c.riskLevel === "Low").length,
    };
  });
}

export function exceptionPareto(claims: KpiClaim[]) {
  const counts = new Map<string, number>();
  for (const c of claims) for (const e of c.exceptions) counts.set(e.anomalyType, (counts.get(e.anomalyType) ?? 0) + 1);
  return [...counts.entries()].map(([anomalyType, count]) => ({ anomalyType, count })).sort((a, b) => b.count - a.count);
}

export function topVendors(claims: KpiClaim[], limit = 5) {
  const map = new Map<string, { vendor: string; spendCents: number; claims: number; exceptions: number }>();
  for (const c of claims) {
    const row = map.get(c.vendorName) ?? { vendor: c.vendorName, spendCents: 0, claims: 0, exceptions: 0 };
    row.spendCents += c.amountCents;
    row.claims += 1;
    row.exceptions += c.exceptions.length;
    map.set(c.vendorName, row);
  }
  return [...map.values()].sort((a, b) => b.spendCents - a.spendCents).slice(0, limit);
}

export function projectUtilization(claims: KpiClaim[], projects: KpiProject[], limit = 6) {
  return projects
    .map((p) => {
      const spendCents = claims.filter((c) => c.projectCode === p.code).reduce((s, c) => s + c.amountCents, 0);
      return { code: p.code, name: p.name, spendCents, budgetCents: p.budgetCents, utilization: ratio(spendCents, p.budgetCents) };
    })
    .sort((a, b) => b.utilization - a.utilization)
    .slice(0, limit);
}

/** Percent change vs previous period; null when the previous period is empty. */
export function delta(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return (current - previous) / Math.abs(previous);
}
