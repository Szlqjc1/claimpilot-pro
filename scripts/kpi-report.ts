// Prints seed KPI values and checks them against the target ranges in the build spec (Section 19.6).
import { prisma } from "../src/lib/db";
import { getDashboardData } from "../src/lib/kpi/queries";
import { claimFiltersSchema } from "../src/lib/domain/schemas";
import { formatUsd } from "../src/lib/domain/money";

async function main() {
  const data = await getDashboardData(claimFiltersSchema.parse({ range: "12m" }));
  const k = data.kpis;
  const counts = await prisma.claim.groupBy({ by: ["status"], _count: true });
  const exTypes = await prisma.exception.groupBy({ by: ["anomalyType"], _count: true });
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  let failures = 0;
  const check = (label: string, value: string, ok: boolean) => {
    if (!ok) failures++;
    console.log(`${ok ? "OK  " : "FAIL"} ${label.padEnd(26)} ${value}`);
  };

  console.log(`Period: ${data.period.label} (as of ${data.anchor.toISOString()})`);
  console.log(`Claims by status: ${counts.map((c) => `${c.status}=${c._count}`).join(", ")}`);
  check("Total claim spend", formatUsd(k.totalSpendCents), k.totalSpendCents >= 350_000_000 && k.totalSpendCents <= 550_000_000);
  check("Claims in scope", String(k.claimsInScope), k.claimsInScope >= 120);
  check("Auto-clear rate", pct(k.autoClearRate), k.autoClearRate >= 0.55 && k.autoClearRate <= 0.7);
  check("Exception rate", pct(k.exceptionRate), k.exceptionRate >= 0.25 && k.exceptionRate <= 0.4);
  check("High-risk exposure", formatUsd(k.highRiskExposureCents), k.highRiskExposureCents >= 30_000_000 && k.highRiskExposureCents <= 70_000_000);
  check("Avg cycle time", `${k.avgCycleHours.toFixed(1)} h`, k.avgCycleHours < 24);
  check("Duplicate recovery", formatUsd(k.duplicateRecoveryCents), k.duplicateRecoveryCents >= 1_000_000);
  check("Anomaly types in Pareto", String(exTypes.length), exTypes.length >= 8);
  console.log(`  OCR straight-through ${pct(k.ocrStraightThroughRate)} · benchmark variance ${pct(k.benchmarkVariance)} · budget utilization ${pct(k.budgetUtilization)}`);
  console.log(`  Project utilization: ${data.projectUtilization.map((p) => `${p.code} ${pct(p.utilization)}`).join(", ")}`);
  console.log(`  Watchlist: ${data.watchlist.map((w) => w.title).join(" | ") || "(none)"}`);
  console.log(`  Exceptions: ${exTypes.map((e) => `${e.anomalyType}=${e._count}`).join(", ")}`);
  if (failures) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
