import type { SiteSpend } from "@/lib/kpi/locations";
import type { SiteId } from "@/lib/locations";
import { formatUsdCompact } from "@/lib/domain/money";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// Fixed per site so a site keeps its colour when the ranking changes with the filters.
const DOT: Record<SiteId, string> = {
  "auburn-hills": "#122c47",
  toledo: "#175cd3",
  chattanooga: "#067647",
  "san-antonio": "#c2410c",
  laredo: "#7a5af8",
  unassigned: "#98a2b3",
};

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

/** Spend by site (D-43): one row per site, with the share of claims attributed through the submitter disclosed. */
export function SiteSpendCard({ rows }: { rows: SiteSpend[] }) {
  return (
    <Card className="mt-6" data-testid="site-spend">
      <CardHeader>
        <div>
          <CardTitle>Spend by site</CardTitle>
          <CardDescription>Where the money is spent: invoice ship-to plant, else the submitter&apos;s home site</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="py-2">
        <ul className="divide-y divide-line">
          {rows.map((r) => {
            const unassigned = r.site.id === "unassigned";
            return (
              <li key={r.site.id} className={cn("grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 py-2.5 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_7rem_4rem_minmax(0,1.4fr)]", unassigned && "text-muted")}>
                <div className="flex min-w-0 items-start gap-2.5">
                  <span aria-hidden className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: DOT[r.site.id] }} />
                  <div className="min-w-0">
                    <p className={cn("truncate text-[13px] font-medium", unassigned ? "text-muted" : "text-ink")}>{r.site.name}</p>
                    <p className="text-[11px] text-muted">
                      {r.claims} {r.claims === 1 ? "claim" : "claims"} · {r.travelClaims} by submitter
                    </p>
                  </div>
                </div>
                <p className="hidden text-[13px] text-muted sm:block">{unassigned ? "—" : `${r.site.city}, ${r.site.state}`}</p>
                <p className={cn("text-right text-[13px] font-semibold tabular-nums", unassigned ? "text-muted" : "text-ink")}>{unassigned && r.claims === 0 ? "—" : formatUsdCompact(r.spendCents)}</p>
                <p className="hidden text-right text-[13px] tabular-nums text-muted sm:block">{pct(r.share)}</p>
                <div className="col-span-2 sm:col-span-1" aria-hidden>
                  <div className="h-1 w-full rounded-full bg-slate-100">
                    <div className="h-1 rounded-full" style={{ width: `${Math.min(100, r.share * 100)}%`, backgroundColor: DOT[r.site.id] }} />
                  </div>
                </div>
                <span className="sr-only">{pct(r.share)} of spend{r.topCategory ? `, mostly ${r.topCategory}` : ""}.</span>
              </li>
            );
          })}
        </ul>
      </CardContent>
      <p className="border-t border-line px-5 py-3 text-[12px] text-muted">
        Off-site claims — travel, entertainment and supplier audits — carry no ship-to plant, so they are attributed to the submitter&apos;s home site. The split is shown per row. Claims not yet audited have no extraction and are attributed the same way.
      </p>
    </Card>
  );
}
