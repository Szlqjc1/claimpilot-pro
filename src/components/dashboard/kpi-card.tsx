import { ArrowDownRight, ArrowRight, ArrowUpRight, Info } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function KpiCard({
  label,
  value,
  delta,
  explanation,
  formula,
  compact = false,
}: {
  label: string;
  value: string;
  delta: number | null;
  explanation: string;
  formula: string;
  compact?: boolean;
}) {
  const dir = delta === null ? null : Math.abs(delta) < 0.0005 ? "flat" : delta > 0 ? "up" : "down";
  const Icon = dir === "up" ? ArrowUpRight : dir === "down" ? ArrowDownRight : ArrowRight;
  const deltaText = delta === null ? "No prior-period data" : `${dir === "up" ? "+" : dir === "down" ? "−" : ""}${Math.abs(delta * 100).toFixed(1)}% vs prior period`;
  return (
    <Card className={cn("flex flex-col gap-1.5", compact ? "p-4" : "p-5")}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-medium text-muted">{label}</h3>
        <Tooltip content={<span>{formula}</span>}>
          <button type="button" aria-label={`How ${label} is calculated`} className="rounded p-0.5 text-slate-400 hover:text-ink">
            <Info className="h-3.5 w-3.5" aria-hidden />
          </button>
        </Tooltip>
      </div>
      <p className={cn("tabular font-semibold tracking-tight text-ink", compact ? "text-xl" : "text-[26px] leading-8")}>{value}</p>
      <p className="flex items-center gap-1 text-xs text-slate-600">
        {dir && <Icon className="h-3.5 w-3.5" aria-hidden />}
        <span>{deltaText}</span>
      </p>
      {!compact && <p className="text-xs text-muted">{explanation}</p>}
    </Card>
  );
}
