"use client";

import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Optional LLM explanation of KPI movement (live mode only). The watchlist itself stays deterministic. */
export function ExplainButton({ query }: { query: string }) {
  const [state, setState] = useState<{ loading: boolean; text: string | null; error: string | null }>({ loading: false, text: null, error: null });
  return (
    <div className="flex max-w-sm flex-col items-end gap-2">
      <Button
        size="sm"
        disabled={state.loading}
        onClick={async () => {
          setState({ loading: true, text: null, error: null });
          try {
            const res = await fetch(`/api/kpis/explain${query ? `?${query}` : ""}`, { method: "POST" });
            const body = (await res.json()) as { explanation?: string; error?: { message: string } };
            setState({ loading: false, text: body.explanation ?? null, error: res.ok ? null : (body.error?.message ?? "Failed") });
          } catch {
            setState({ loading: false, text: null, error: "Network error" });
          }
        }}
      >
        {state.loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Sparkles className="h-3.5 w-3.5" aria-hidden />}
        Explain this movement
      </Button>
      <div aria-live="polite" className="text-right text-xs text-muted">
        {state.text && <p className="rounded-lg bg-slate-50 p-2 text-left text-ink">{state.text}</p>}
        {state.error && <p className="text-danger">{state.error}</p>}
      </div>
    </div>
  );
}
