"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { CATEGORIES, CLAIM_STATUSES, DEPARTMENTS, RISK_LEVELS } from "@/lib/domain/constants";
import { Input, Label, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const KEYS = ["q", "department", "category", "status", "risk", "range", "from", "to", "project", "vendor", "anomaly"] as const;

/** Filter state lives in the URL so the list and the KPI cards read the same filters. */
export function ClaimFilters({ showStatus = true }: { showStatus?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(params.get("q") ?? "");

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete("page");
    startTransition(() => router.push(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false }));
  };

  const active = KEYS.some((k) => params.get(k));
  const range = params.get("range") ?? "12m";
  const extra = (["project", "vendor", "anomaly"] as const).filter((k) => params.get(k));

  return (
    <div className="space-y-3" aria-busy={pending}>
      <form
        className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6"
        onSubmit={(e) => {
          e.preventDefault();
          update({ q: q.trim() || null });
        }}
      >
        <div className="col-span-2 md:col-span-3 xl:col-span-1">
          <Label htmlFor="f-q">Search</Label>
          <Input id="f-q" value={q} onChange={(e) => setQ(e.target.value)} onBlur={() => q !== (params.get("q") ?? "") && update({ q: q.trim() || null })} placeholder="ID, vendor, invoice…" />
        </div>
        <div>
          <Label htmlFor="f-dept">Department</Label>
          <Select id="f-dept" value={params.get("department") ?? ""} onChange={(e) => update({ department: e.target.value })}>
            <option value="">All departments</option>
            {DEPARTMENTS.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="f-cat">Category</Label>
          <Select id="f-cat" value={params.get("category") ?? ""} onChange={(e) => update({ category: e.target.value })}>
            <option value="">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </div>
        {showStatus && (
          <div>
            <Label htmlFor="f-status">Status</Label>
            <Select id="f-status" value={params.get("status") ?? ""} onChange={(e) => update({ status: e.target.value })}>
              <option value="">All statuses</option>
              {CLAIM_STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </Select>
          </div>
        )}
        <div>
          <Label htmlFor="f-risk">Risk</Label>
          <Select id="f-risk" value={params.get("risk") ?? ""} onChange={(e) => update({ risk: e.target.value })}>
            <option value="">All risk levels</option>
            {RISK_LEVELS.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="f-range">Date range</Label>
          <Select id="f-range" value={range} onChange={(e) => update({ range: e.target.value === "12m" ? null : e.target.value, ...(e.target.value !== "custom" ? { from: null, to: null } : {}) })}>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
            <option value="12m">Last 12 months</option>
            <option value="custom">Custom…</option>
          </Select>
        </div>
        <button type="submit" className="sr-only">
          Apply filters
        </button>
      </form>
      {(range === "custom" || active) && (
        <div className="flex flex-wrap items-end gap-3">
          {range === "custom" && (
            <>
              <div>
                <Label htmlFor="f-from">From</Label>
                <Input id="f-from" type="date" defaultValue={params.get("from") ?? ""} onChange={(e) => update({ from: e.target.value, range: "custom" })} />
              </div>
              <div>
                <Label htmlFor="f-to">To</Label>
                <Input id="f-to" type="date" defaultValue={params.get("to") ?? ""} onChange={(e) => update({ to: e.target.value, range: "custom" })} />
              </div>
            </>
          )}
          {extra.map((k) => (
            <span key={k} className="inline-flex items-center gap-1 rounded-full border border-line bg-white px-2.5 py-1 text-xs">
              <span className="text-muted">{k}:</span> {params.get(k)}
              <button type="button" aria-label={`Remove ${k} filter`} className="ml-1 text-muted hover:text-ink" onClick={() => update({ [k]: null })}>
                ×
              </button>
            </span>
          ))}
          {active && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setQ("");
                startTransition(() => router.push(pathname, { scroll: false }));
              }}
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Reset filters
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
