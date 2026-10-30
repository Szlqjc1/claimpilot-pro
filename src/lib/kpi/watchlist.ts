import { formatUsd } from "@/lib/domain/money";
import { computeKpis, type KpiBenchmark, type KpiClaim, type KpiProject } from "./formulas";

export type WatchItem = {
  id: string;
  severity: "High" | "Medium" | "Low";
  title: string;
  detail: string;
  href: string;
};

const SEVERITY_RANK = { High: 0, Medium: 1, Low: 2 } as const;
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const monthIndex = (d: Date) => d.getUTCFullYear() * 12 + d.getUTCMonth();

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Deterministic KPI callouts (max 3). `periodClaims` honours the date filter; `allClaims`
 * ignores it so month-over-month comparisons have history. `asOf` is the data anchor date.
 */
export function buildWatchlist(input: {
  periodClaims: KpiClaim[];
  allClaims: KpiClaim[];
  projects: KpiProject[];
  benchmarks: KpiBenchmark[];
  asOf: Date;
}): WatchItem[] {
  const { periodClaims, allClaims, projects, benchmarks, asOf } = input;
  const items: WatchItem[] = [];
  const k = computeKpis(periodClaims, benchmarks, projects);

  // Project > 90% budget utilized
  for (const p of projects) {
    const spend = periodClaims.filter((c) => c.projectCode === p.code).reduce((s, c) => s + c.amountCents, 0);
    const u = p.budgetCents ? spend / p.budgetCents : 0;
    if (u > 0.9)
      items.push({
        id: `budget-${p.code}`,
        severity: "High",
        title: `${p.code} is ${pct(u)} budget-utilized`,
        detail: `${formatUsd(spend)} of ${formatUsd(p.budgetCents)} committed on ${p.name}.`,
        href: `/claims?project=${encodeURIComponent(p.code)}`,
      });
  }

  if (k.duplicateRecoveryCents > 1_000_000)
    items.push({
      id: "duplicates",
      severity: "High",
      title: `${formatUsd(k.duplicateRecoveryCents)} in duplicate supplier invoices caught`,
      detail: "Duplicate recovery exceeded $10,000 this period — review vendor statement reconciliation.",
      href: `/claims?anomaly=${encodeURIComponent("Duplicate Supplier Invoice")}`,
    });

  if (k.highRiskRate > 0.15)
    items.push({
      id: "high-risk-rate",
      severity: "Medium",
      title: `High-risk rate at ${pct(k.highRiskRate)} of analyzed claims`,
      detail: `Above the 15% tolerance; ${formatUsd(k.highRiskExposureCents)} of spend is High risk.`,
      href: "/claims?risk=High",
    });

  if (k.avgCycleHours > 48)
    items.push({
      id: "cycle-time",
      severity: "Medium",
      title: `Average cycle time ${k.avgCycleHours.toFixed(1)} h`,
      detail: "Above the 48-hour service level for AI-RPA review.",
      href: "/claims?status=Pending",
    });

  // Category spend spike: this month vs trailing 3-month median.
  const thisMonth = monthIndex(asOf);
  const byCat = new Map<string, Map<number, number>>();
  for (const c of allClaims) {
    const m = byCat.get(c.category) ?? new Map<number, number>();
    m.set(monthIndex(c.submittedAt), (m.get(monthIndex(c.submittedAt)) ?? 0) + c.amountCents);
    byCat.set(c.category, m);
  }
  for (const [category, months] of byCat) {
    const current = months.get(thisMonth) ?? 0;
    const base = median([1, 2, 3].map((i) => months.get(thisMonth - i) ?? 0));
    if (current > 2_500_000 && current > base * 1.25)
      items.push({
        id: `spike-${category}`,
        severity: "Medium",
        title: `${category} spend up ${base ? pct(current / base - 1) : "from zero"} this month`,
        detail: `${formatUsd(current)} vs trailing 3-month median ${formatUsd(Math.round(base))}.`,
        href: `/claims?category=${encodeURIComponent(category)}&range=30d`,
      });
  }

  // Vendor concentration — only meaningful where a category has more than one active vendor.
  const catVendors = new Map<string, Map<string, number>>();
  for (const c of periodClaims) {
    const m = catVendors.get(c.category) ?? new Map<string, number>();
    m.set(c.vendorName, (m.get(c.vendorName) ?? 0) + c.amountCents);
    catVendors.set(c.category, m);
  }
  for (const [category, vendors] of catVendors) {
    if (vendors.size < 2) continue;
    const total = [...vendors.values()].reduce((a, b) => a + b, 0);
    for (const [vendor, spend] of vendors) {
      if (total > 0 && spend / total > 0.35 && spend / total < 1)
        items.push({
          id: `concentration-${category}-${vendor}`,
          severity: "Low",
          title: `${vendor} holds ${pct(spend / total)} of ${category}`,
          detail: "Supplier concentration above 35% — confirm dual-source plan.",
          href: `/claims?category=${encodeURIComponent(category)}&vendor=${encodeURIComponent(vendor)}`,
        });
    }
  }

  return items.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]).slice(0, 3);
}
