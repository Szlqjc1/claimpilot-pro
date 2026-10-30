import { NextResponse } from "next/server";
import { claimFiltersSchema } from "@/lib/domain/schemas";
import { getDashboardData } from "@/lib/kpi/queries";
import { newRequestId } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Same formulas as the dashboard server page (lib/kpi). */
export async function GET(req: Request) {
  const requestId = newRequestId();
  const params = Object.fromEntries(new URL(req.url).searchParams);
  const filters = claimFiltersSchema.parse(params);
  const data = await getDashboardData(filters);
  return NextResponse.json(
    {
      period: { label: data.period.label, from: data.period.from.toISOString(), to: data.period.to.toISOString() },
      asOf: data.anchor.toISOString(),
      kpis: data.kpis,
      previousKpis: data.hasPrevious ? data.previousKpis : null,
      watchlist: data.watchlist,
    },
    { headers: { "x-request-id": requestId } },
  );
}
