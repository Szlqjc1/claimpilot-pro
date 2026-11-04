import { NextResponse } from "next/server";
import { claimFiltersSchema } from "@/lib/domain/schemas";
import { getDashboardData } from "@/lib/kpi/queries";
import { aiConfig } from "@/lib/ai/provider";
import { ProviderError, explainKpiWithDeepSeek } from "@/lib/ai/deepseek";
import { isSameOrigin, jsonError, newRequestId, rateLimit } from "@/lib/api";
import { requireUser } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Optional "Explain this movement": the LLM sees only KPI JSON; the deterministic watchlist stays the source of truth. */
export async function POST(req: Request) {
  const requestId = newRequestId();
  if (!(await requireUser({ api: true }))) return jsonError(401, "UNAUTHENTICATED", "Sign in to continue", requestId);
  if (!isSameOrigin(req)) return jsonError(403, "CROSS_ORIGIN", "Cross-origin requests are not allowed", requestId);
  const cfg = aiConfig();
  if (cfg.mode !== "live" || !cfg.apiKey) return jsonError(503, "AI_NOT_CONFIGURED", "AI provider is not configured", requestId);
  if (!rateLimit("kpi-explain", 10)) return jsonError(429, "RATE_LIMITED", "Too many requests", requestId);

  const filters = claimFiltersSchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  const data = await getDashboardData(filters);
  const payload = JSON.stringify({ period: data.period.label, current: data.kpis, previous: data.hasPrevious ? data.previousKpis : null, watchlist: data.watchlist.map((w) => w.title) });
  try {
    const explanation = await explainKpiWithDeepSeek(payload, requestId);
    return NextResponse.json({ explanation }, { headers: { "x-request-id": requestId } });
  } catch (err) {
    const msg = err instanceof ProviderError ? err.message : "Explanation failed";
    return jsonError(502, "AI_PROVIDER_FAILED", msg, requestId);
  }
}
