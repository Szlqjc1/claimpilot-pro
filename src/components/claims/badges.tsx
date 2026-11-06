import { AlertTriangle, CheckCircle2, CircleDot, Clock, ShieldAlert, ShieldCheck, UserRoundCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { provenanceLabel } from "@/lib/domain/provenance";

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
      {score !== undefined && score !== null && <span className="tabular font-normal">· {score}</span>}
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

/** Escalation assignment (D-34): the owner when there is one, otherwise the role nobody eligible owns. */
export function AssignedBadge({ role, owner }: { role: string; owner: string | null }) {
  return (
    <Badge tone="navy" title={`${role} · ${owner ?? "unassigned — submitter is the role owner"}`}>
      <UserRoundCheck className="h-3 w-3" aria-hidden /> Assigned · {owner ?? role}
    </Badge>
  );
}

export function ProvenanceBadge({ source }: { source: string | null | undefined }) {
  const p = provenanceLabel(source);
  if (!p) return null;
  return (
    <Badge tone={source === "model" ? "blue" : "amber"} title={p.title} data-testid="provenance-badge">
      {p.label}
    </Badge>
  );
}

