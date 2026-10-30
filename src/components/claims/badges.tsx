import { AlertTriangle, CheckCircle2, CircleDot, Clock, ShieldAlert, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";

// Badges always carry a text label — color is never the only signal.

export function StatusBadge({ status }: { status: string }) {
  if (status === "Pending")
    return (
      <Badge tone="amber">
        <Clock className="h-3 w-3" aria-hidden /> Pending
      </Badge>
    );
  if (status === "Analyzed")
    return (
      <Badge tone="blue">
        <CircleDot className="h-3 w-3" aria-hidden /> Analyzed
      </Badge>
    );
  return (
    <Badge tone="green">
      <CheckCircle2 className="h-3 w-3" aria-hidden /> {status}
    </Badge>
  );
}

export function RiskBadge({ level, score }: { level: string | null; score?: number | null }) {
  if (!level) return <span className="text-xs text-slate-400">—</span>;
  const tone = level === "High" ? "red" : level === "Medium" ? "amber" : "green";
  const Icon = level === "High" ? ShieldAlert : level === "Medium" ? AlertTriangle : ShieldCheck;
  return (
    <Badge tone={tone}>
      <Icon className="h-3 w-3" aria-hidden />
      {level}
      {score !== undefined && score !== null && <span className="tabular opacity-80">· {score}</span>}
    </Badge>
  );
}

export function DecisionBadge({ decision }: { decision: string | null }) {
  if (!decision) return null;
  const tone = decision === "ESCALATE" ? "red" : decision === "REVIEW" ? "amber" : "green";
  return (
    <Badge tone={tone} className="font-mono tracking-tight">
      {decision}
    </Badge>
  );
}
