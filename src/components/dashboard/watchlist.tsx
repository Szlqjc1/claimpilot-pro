import Link from "next/link";
import { AlertOctagon, AlertTriangle, ArrowRight, Eye, Info } from "lucide-react";
import type { WatchItem } from "@/lib/kpi/watchlist";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ExplainButton } from "./explain-button";

export function Watchlist({ items, explainEnabled, query }: { items: WatchItem[]; explainEnabled: boolean; query: string }) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <Eye className="h-4 w-4 text-accent" aria-hidden /> KPI Watchlist
          </CardTitle>
          <CardDescription>Deterministic callouts from the KPI engine (max 3)</CardDescription>
        </div>
        {explainEnabled && <ExplainButton query={query} />}
      </CardHeader>
      <CardContent className="p-0">
        {items.length === 0 ? (
          <p className="px-5 py-6 text-[13px] text-muted">No KPI thresholds breached for this selection.</p>
        ) : (
          <ul className="divide-y divide-line">
            {items.map((w) => {
              const Icon = w.severity === "High" ? AlertOctagon : w.severity === "Medium" ? AlertTriangle : Info;
              const tone = w.severity === "High" ? "red" : w.severity === "Medium" ? "amber" : "blue";
              return (
                <li key={w.id} className="flex items-start gap-3 px-5 py-3.5">
                  <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${w.severity === "High" ? "text-danger" : w.severity === "Medium" ? "text-warning" : "text-info"}`} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{w.title}</p>
                      <Badge tone={tone}>{w.severity}</Badge>
                    </div>
                    <p className="mt-0.5 text-[13px] text-muted">{w.detail}</p>
                  </div>
                  <Link href={w.href} className="inline-flex shrink-0 items-center gap-1 text-[13px] font-medium text-info hover:underline">
                    View claims <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
