import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { toCents } from "@/lib/domain/money";
import { addDays, isoDate, toIsoDate } from "@/lib/domain/dates";
import { parseExtractedData, type ClaimFilters } from "@/lib/domain/schemas";
import {
  categoryMix,
  computeKpis,
  exceptionPareto,
  monthlyTrend,
  projectUtilization,
  riskByDepartment,
  topVendors,
  type KpiBenchmark,
  type KpiClaim,
  type KpiProject,
} from "./formulas";
import { buildWatchlist } from "./watchlist";
import { computeSiteSpend } from "./locations";

export type Period = { from: Date; to: Date; prevFrom: Date; prevTo: Date; label: string; range: string };

/**
 * The data "as of" date: the latest claim submission. Anchoring periods to the data
 * (not the wall clock) keeps the demo dashboard meaningful whenever it is opened.
 */
export async function dataAnchor(): Promise<Date> {
  const latest = await prisma.claim.findFirst({ orderBy: { submittedAt: "desc" }, select: { submittedAt: true } });
  return latest?.submittedAt ?? new Date();
}

export function resolvePeriod(filters: Pick<ClaimFilters, "range" | "from" | "to">, anchor: Date): Period {
  const range = filters.range ?? "12m";
  let to = addDays(isoDate(toIsoDate(anchor)), 1);
  let from: Date;
  let label: string;
  if (range === "custom" && filters.from && filters.to) {
    from = isoDate(filters.from);
    to = addDays(isoDate(filters.to), 1);
    label = `${filters.from} – ${filters.to}`;
  } else if (range === "30d") {
    from = addDays(to, -30);
    label = "Last 30 days";
  } else if (range === "90d") {
    from = addDays(to, -90);
    label = "Last 90 days";
  } else {
    from = new Date(Date.UTC(to.getUTCFullYear() - 1, to.getUTCMonth(), to.getUTCDate()));
    label = "Last 12 months";
  }
  if (from >= to) from = addDays(to, -1);
  const len = to.getTime() - from.getTime();
  return { from, to, prevFrom: new Date(from.getTime() - len), prevTo: from, label, range };
}

/** Non-date filters shared by the claims list and the KPI cards. */
export function claimWhere(filters: ClaimFilters): Prisma.ClaimWhereInput {
  const where: Prisma.ClaimWhereInput = {};
  if (filters.department) where.department = filters.department;
  if (filters.category) where.category = filters.category;
  if (filters.status) where.status = filters.status;
  if (filters.risk) where.riskLevel = filters.risk;
  if (filters.project) where.projectCode = filters.project;
  if (filters.vendor) where.vendorName = filters.vendor;
  if (filters.anomaly) where.exceptions = { some: { anomalyType: filters.anomaly } };
  if (filters.q) {
    where.OR = [
      { claimId: { contains: filters.q } },
      { vendorName: { contains: filters.q } },
      { invoiceNumber: { contains: filters.q } },
      { employee: { contains: filters.q } },
      { projectCode: { contains: filters.q } },
    ];
  }
  return where;
}

export function withPeriod(where: Prisma.ClaimWhereInput, from: Date, to: Date): Prisma.ClaimWhereInput {
  return { AND: [where, { submittedAt: { gte: from, lt: to } }] };
}

async function loadKpiClaims(where: Prisma.ClaimWhereInput): Promise<KpiClaim[]> {
  const rows = await prisma.claim.findMany({
    where,
    select: {
      claimId: true,
      employee: true,
      amount: true,
      status: true,
      decision: true,
      riskLevel: true,
      submittedAt: true,
      analyzedAt: true,
      department: true,
      category: true,
      projectCode: true,
      vendorName: true,
      extractedData: true,
      exceptions: { select: { anomalyType: true, status: true, riskLevel: true } },
    },
  });
  return rows.map((r) => {
    const parsed = parseExtractedData(r.extractedData);
    return {
      claimId: r.claimId,
      amountCents: toCents(r.amount),
      status: r.status,
      decision: r.decision,
      riskLevel: r.riskLevel,
      submittedAt: r.submittedAt,
      analyzedAt: r.analyzedAt,
      department: r.department,
      category: r.category,
      projectCode: r.projectCode,
      vendorName: r.vendorName,
      exceptions: r.exceptions,
      employee: r.employee,
      shipToPlant: parsed?.ok ? parsed.data.shipTo.plant : null,
      lineItems: parsed?.ok ? parsed.data.lineItems.map((l) => ({ partNumber: l.partNumber, unitPrice: l.unitPrice, amount: l.amount })) : [],
    };
  });
}

async function loadReference(): Promise<{ benchmarks: KpiBenchmark[]; projects: KpiProject[] }> {
  const [benchmarks, projects] = await Promise.all([prisma.benchmark.findMany(), prisma.project.findMany({ orderBy: { code: "asc" } })]);
  return {
    benchmarks: benchmarks.map((b) => ({ itemCode: b.itemCode, p50Cents: toCents(b.p50) })),
    projects: projects.map((p) => ({ code: p.code, name: p.name, budgetCents: toCents(p.budget) })),
  };
}

export async function getDashboardData(filters: ClaimFilters) {
  const anchor = await dataAnchor();
  const period = resolvePeriod(filters, anchor);
  const [allClaims, ref] = await Promise.all([loadKpiClaims(claimWhere(filters)), loadReference()]);
  const inRange = (c: KpiClaim, from: Date, to: Date) => c.submittedAt >= from && c.submittedAt < to;
  const current = allClaims.filter((c) => inRange(c, period.from, period.to));
  const previous = allClaims.filter((c) => inRange(c, period.prevFrom, period.prevTo));
  const projects = filters.project ? ref.projects.filter((p) => p.code === filters.project) : ref.projects;

  return {
    anchor,
    period,
    kpis: computeKpis(current, ref.benchmarks, projects),
    previousKpis: computeKpis(previous, ref.benchmarks, projects),
    hasPrevious: previous.length > 0,
    trend: monthlyTrend(allClaims.filter((c) => c.submittedAt < period.to), addDays(period.to, -1)),
    categoryMix: categoryMix(current),
    riskByDepartment: riskByDepartment(current),
    pareto: exceptionPareto(current),
    topVendors: topVendors(current),
    projectUtilization: projectUtilization(current, projects),
    // Same claims as the KPI strip, same single parse of extractedData (no second scan).
    siteSpend: computeSiteSpend(current.map((c) => ({ employee: c.employee ?? "", department: c.department, category: c.category, amountCents: c.amountCents, shipToPlant: c.shipToPlant ?? null }))),
    watchlist: buildWatchlist({ periodClaims: current, allClaims, projects, benchmarks: ref.benchmarks, asOf: anchor }),
  };
}

export type DashboardData = Awaited<ReturnType<typeof getDashboardData>>;

export const PAGE_SIZE = 10;

export async function getClaimsPage(filters: ClaimFilters) {
  const anchor = await dataAnchor();
  const period = resolvePeriod(filters, anchor);
  const where = withPeriod(claimWhere(filters), period.from, period.to);
  const [total, rows] = await Promise.all([
    prisma.claim.count({ where }),
    prisma.claim.findMany({
      where,
      orderBy: [{ submittedAt: "desc" }, { claimId: "desc" }],
      skip: (filters.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        claimId: true,
        employee: true,
        department: true,
        projectCode: true,
        category: true,
        amount: true,
        status: true,
        riskLevel: true,
        vendorName: true,
        submittedAt: true,
      },
    }),
  ]);
  return {
    total,
    page: filters.page,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    period,
    rows: rows.map(({ amount, submittedAt, ...r }) => ({ ...r, amountCents: toCents(amount), submittedAt: submittedAt.toISOString() })),
  };
}

export type ClaimRow = Awaited<ReturnType<typeof getClaimsPage>>["rows"][number];
