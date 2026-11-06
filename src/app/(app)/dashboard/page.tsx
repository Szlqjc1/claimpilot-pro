import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Plus } from "lucide-react";
import { claimFiltersSchema } from "@/lib/domain/schemas";
import { getClaimsPage, getDashboardData, PAGE_SIZE } from "@/lib/kpi/queries";
import { delta } from "@/lib/kpi/formulas";
import { formatUsd, formatUsdCompact } from "@/lib/domain/money";
import { formatEtDate } from "@/lib/domain/dates";
import { aiStatus } from "@/lib/ai/provider";
import { PageHeader } from "@/components/shell/page-header";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { Watchlist } from "@/components/dashboard/watchlist";
import { BudgetChart, CategoryMixChart, ParetoChart, RiskDistributionChart, SpendTrendChart } from "@/components/dashboard/charts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { buttonVariants } from "@/components/ui/button";
import { ClaimFilters } from "@/components/claims/filters";
import { ClaimsTable } from "@/components/claims/claims-table";
import { Pagination } from "@/components/claims/pagination";

export const metadata: Metadata = { title: "Claims Dashboard" };

type SP = Promise<Record<string, string | string[] | undefined>>;

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

export default async function DashboardPage({ searchParams }: { searchParams: SP }) {
  const raw = Object.fromEntries(Object.entries(await searchParams).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  const filters = claimFiltersSchema.parse(raw);
  const [d, list] = await Promise.all([getDashboardData(filters), getClaimsPage(filters)]);
  const k = d.kpis;
  const p = d.previousKpis;
  const dl = (cur: number, prev: number) => (d.hasPrevious ? delta(cur, prev) : null);
  const ai = aiStatus();
  const query = new URLSearchParams(Object.entries(raw).filter((e): e is [string, string] => !!e[1] && e[0] !== "page")).toString();

  return (
    <>
      <PageHeader
        title="Claims Dashboard"
        subtitle={
          <>
            AI-RPA spend, risk, and exception overview · FY2026 <span aria-hidden className="text-slate-400">·</span> {d.period.label}, data as of {formatEtDate(d.anchor)}
          </>
        }
        actions={
          <Link href="/claims/new" className={buttonVariants({ variant: "navy" })}>
            <Plus className="h-4 w-4" aria-hidden /> New Claim
          </Link>
        }
      />

      <Card className="mb-6 p-4">
        <Suspense>
          <ClaimFilters />
        </Suspense>
      </Card>

      <section aria-label="Key performance indicators" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <KpiCard label="Total Claim Spend" value={formatUsdCompact(k.totalSpendCents)} delta={dl(k.totalSpendCents, p.totalSpendCents)} explanation="All submitted claims in the period." formula="sum(Amount) for claims submitted in the selected period" />
        <KpiCard label="Claims in Scope" value={k.claimsInScope.toLocaleString("en-US")} delta={dl(k.claimsInScope, p.claimsInScope)} explanation={`${k.analyzedCount} analyzed or posted.`} formula="count(claims) submitted in the selected period" />
        <KpiCard label="Auto-Clear Rate" value={pct(k.autoClearRate)} delta={dl(k.autoClearRate, p.autoClearRate)} explanation="Cleared with zero findings." formula="claims with decision AUTO_APPROVE ÷ claims with status Analyzed or Posted" />
        <KpiCard label="Exception Rate" value={pct(k.exceptionRate)} delta={dl(k.exceptionRate, p.exceptionRate)} explanation={`${k.openExceptionClaims} claim(s) with open exceptions.`} formula="claims with ≥1 exception raised ÷ claims with status Analyzed or Posted (see DECISIONS.md)" />
        <KpiCard label="High-Risk Exposure" value={formatUsdCompact(k.highRiskExposureCents)} delta={dl(k.highRiskExposureCents, p.highRiskExposureCents)} explanation="Spend on claims scored High." formula="sum(Amount) where Risk Level = High" />
        <KpiCard label="Avg Cycle Time" value={`${k.avgCycleHours.toFixed(1)} h`} delta={dl(k.avgCycleHours, p.avgCycleHours)} explanation="Manual baseline: 4.2 days (100.8 h)." formula="average hours from submittedAt to analyzedAt for Analyzed/Posted claims" />
      </section>
      <section aria-label="Secondary indicators" className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard compact label="OCR Straight-Through" value={pct(k.ocrStraightThroughRate)} delta={dl(k.ocrStraightThroughRate, p.ocrStraightThroughRate)} explanation="" formula="analyzed claims without a Low OCR Confidence exception ÷ analyzed claims" />
        <KpiCard compact label="Duplicate Recovery" value={formatUsd(k.duplicateRecoveryCents)} delta={dl(k.duplicateRecoveryCents, p.duplicateRecoveryCents)} explanation="" formula="sum(Amount) for claims with a Duplicate Supplier Invoice exception" />
        <KpiCard compact label="Benchmark Variance" value={`${k.benchmarkVariance >= 0 ? "+" : ""}${pct(k.benchmarkVariance)}`} delta={dl(k.benchmarkVariance, p.benchmarkVariance)} explanation="" formula="amount-weighted average of (unit price − benchmark p50) ÷ p50 over matched line items" />
        <KpiCard compact label="Budget Utilization" value={pct(k.budgetUtilization)} delta={dl(k.budgetUtilization, p.budgetUtilization)} explanation="" formula="project spend in period ÷ project budget (all selected projects)" />
      </section>

      <div className="mt-6">
        <Watchlist items={d.watchlist} explainEnabled={ai.mode === "live" && ai.configured} query={query} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Monthly spend trend</CardTitle>
              <CardDescription>Last 12 months · bars = actual, line = trailing 3-month average</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <SpendTrendChart data={d.trend} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Risk distribution</CardTitle>
              <CardDescription>Analyzed claims by department and risk level</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <RiskDistributionChart data={d.riskByDepartment} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Category mix</CardTitle>
              <CardDescription>Spend by expense category</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <CategoryMixChart data={d.categoryMix} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Exception Pareto</CardTitle>
              <CardDescription>Exceptions raised by anomaly type</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <ParetoChart data={d.pareto} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Project budget utilization</CardTitle>
              <CardDescription>Top 6 projects · red above 90%</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <BudgetChart data={d.projectUtilization} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Top vendors</CardTitle>
              <CardDescription>Top 5 by spend in the period</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {d.topVendors.length === 0 ? (
              <p className="px-5 py-6 text-[13px] text-muted">No vendor spend for this selection.</p>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Vendor</TH>
                    <TH className="text-right">Spend</TH>
                    <TH className="text-right">Claims</TH>
                    <TH className="text-right">Exceptions</TH>
                  </TR>
                </THead>
                <TBody>
                  {d.topVendors.map((v) => (
                    <TR key={v.vendor}>
                      <TD>
                        <Link href={`/claims?vendor=${encodeURIComponent(v.vendor)}`} className="font-medium hover:underline">
                          {v.vendor}
                        </Link>
                      </TD>
                      <TD className="tabular text-right">{formatUsd(v.spendCents)}</TD>
                      <TD className="tabular text-right">{v.claims}</TD>
                      <TD className="tabular text-right">{v.exceptions}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <div>
            <CardTitle>Claims</CardTitle>
            <CardDescription>Newest first · click a row or View Details to open the claim review</CardDescription>
          </div>
          <Link href="/claims?status=Pending" className="text-[13px] font-medium text-info hover:underline">
            Pending queue →
          </Link>
        </CardHeader>
        <ClaimsTable rows={list.rows} />
        <Pagination basePath="/dashboard" params={raw} page={list.page} pageCount={list.pageCount} total={list.total} pageSize={PAGE_SIZE} />
      </Card>
    </>
  );
}
