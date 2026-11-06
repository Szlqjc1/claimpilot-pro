// Spend by site (Task 12, D-43). Computed in application code from the extraction's ship-to plant: there is no
// Claim.plant column yet, so this cannot be filtered or sorted in SQL.
import { prisma } from "@/lib/db";
import { toCents } from "@/lib/domain/money";
import { parseExtractedData } from "@/lib/domain/schemas";
import { resolveSite, SITES, type Site, type SiteId } from "@/lib/locations";

export type SiteSpend = {
  site: Site;
  claims: number;
  spendCents: number;
  share: number;
  /** Claims attributed through a person (no usable ship-to plant): travel, entertainment, not yet extracted. */
  travelCents: number;
  travelClaims: number;
  topCategory: string | null;
};

export type SiteClaim = { employee: string; department: string; category: string; amountCents: number; shipToPlant: string | null };

/** The ship-to plant of a stored extraction, or null when there is none or it does not parse. */
export function shipToPlantOf(extractedData: string | null | undefined): string | null {
  const parsed = parseExtractedData(extractedData);
  return parsed?.ok ? parsed.data.shipTo.plant : null;
}

/** Pure aggregation. Every site is returned (zero rows included), by spend descending, unassigned last. */
export function computeSiteSpend(claims: SiteClaim[]): SiteSpend[] {
  const acc = new Map<SiteId, { claims: number; spendCents: number; travelCents: number; travelClaims: number; byCategory: Map<string, number> }>();
  for (const s of SITES) acc.set(s.id, { claims: 0, spendCents: 0, travelCents: 0, travelClaims: 0, byCategory: new Map() });
  let total = 0;
  for (const c of claims) {
    const { site, basis } = resolveSite({ shipToPlant: c.shipToPlant, employee: c.employee, department: c.department });
    const a = acc.get(site)!;
    a.claims += 1;
    a.spendCents += c.amountCents;
    a.byCategory.set(c.category, (a.byCategory.get(c.category) ?? 0) + c.amountCents);
    if (basis !== "ship-to") {
      a.travelClaims += 1;
      a.travelCents += c.amountCents;
    }
    total += c.amountCents;
  }
  return SITES.map((site) => {
    const a = acc.get(site.id)!;
    const top = [...a.byCategory].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0];
    return {
      site,
      claims: a.claims,
      spendCents: a.spendCents,
      share: total > 0 ? a.spendCents / total : 0,
      travelCents: a.travelCents,
      travelClaims: a.travelClaims,
      topCategory: top?.[0] ?? null,
    };
  }).sort((x, y) => Number(x.site.id === "unassigned") - Number(y.site.id === "unassigned") || y.spendCents - x.spendCents);
}

/** Spend by site over every claim (one query). The dashboard uses computeSiteSpend on the claims it already loaded. */
export async function siteSpend(): Promise<SiteSpend[]> {
  const rows = await prisma.claim.findMany({ select: { claimId: true, employee: true, department: true, category: true, amount: true, extractedData: true } });
  return computeSiteSpend(
    rows.map((r) => ({ employee: r.employee, department: r.department, category: r.category, amountCents: toCents(r.amount), shipToPlant: shipToPlantOf(r.extractedData) })),
  );
}
