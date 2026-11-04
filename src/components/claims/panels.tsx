import { Calculator, History, ImageIcon, ListChecks, Lock, ShieldQuestion } from "lucide-react";
import { CONFIDENCE_COLORS } from "@/lib/domain/fields";
import { formatEt } from "@/lib/domain/dates";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { DecisionBadge, RiskBadge } from "./badges";
import { ExceptionActions } from "./exception-actions";

/** "AI-Annotated Invoice" — image connected to AI_Analyzed_Receipt. Rendered only for Status === "Analyzed". */
export function AnnotatedInvoice({ src, claimId }: { src: string; claimId: string }) {
  return (
    <Card data-testid="ai-annotated-invoice">
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <ImageIcon className="h-4 w-4 text-info" aria-hidden /> AI-Annotated Invoice
          </CardTitle>
          <CardDescription>AI_Analyzed_Receipt · bounding boxes use the same field names as AI Structured Data</CardDescription>
        </div>
        <a href={src} target="_blank" rel="noopener" className="text-[13px] font-medium text-info hover:underline">
          Open
        </a>
      </CardHeader>
      <CardContent>
        <div className="max-h-[640px] overflow-auto rounded-lg bg-slate-100 p-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- generated SVG streamed from the receipts API */}
          <img src={src} alt={`AI-annotated invoice for ${claimId} with labeled field boxes`} className="mx-auto block w-full rounded bg-white" />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted">
          <span className="font-medium text-ink">Legend</span>
          {(["high", "medium", "low"] as const).map((b) => (
            <span key={b} className="inline-flex items-center gap-1.5">
              <span aria-hidden className="h-3 w-3 rounded-sm border-2" style={{ borderColor: CONFIDENCE_COLORS[b].stroke }} />
              {b === "high" ? "High" : b === "medium" ? "Medium" : "Low"} confidence ({CONFIDENCE_COLORS[b].label})
            </span>
          ))}
          <span className="ml-auto italic">Overlay is AI-generated — demo data.</span>
        </div>
      </CardContent>
    </Card>
  );
}

export function LockedPlaceholder() {
  return (
    <Card className="border-dashed bg-slate-50/60">
      <CardContent className="flex items-start gap-3 py-6">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white shadow-sm">
          <Lock className="h-4 w-4 text-muted" aria-hidden />
        </span>
        <p className="text-[13px] text-slate-700">
          <strong className="font-semibold text-ink">AI analysis locked.</strong> Run the audit to generate structured data and an annotated invoice.
        </p>
      </CardContent>
    </Card>
  );
}

export type FindingRow = { exceptionId: string; ruleId: string; anomalyType: string; riskLevel: string; points: number; message: string; status: string; evidence: string | null };

export function RiskPanel({
  status,
  score,
  level,
  decision,
  findings,
  narrative,
}: {
  status: string;
  score: number | null;
  level: string | null;
  decision: string | null;
  findings: FindingRow[];
  narrative: string | null;
}) {
  const analyzed = status !== "Pending" && score !== null;
  return (
    <Card aria-labelledby="risk-title">
      <CardHeader>
        <div>
          <CardTitle id="risk-title" className="flex items-center gap-2">
            <ShieldQuestion className="h-4 w-4 text-accent" aria-hidden /> Risk Assessment
          </CardTitle>
          <CardDescription>Deterministic rule engine · the LLM only explains, never scores</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {!analyzed ? (
          <p className="text-[13px] text-muted">Not analyzed yet.</p>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-end gap-6">
              <div>
                <p className="text-xs text-muted">Score</p>
                <p className="tabular text-3xl font-semibold">
                  {score}
                  <span className="text-base font-normal text-muted">/100</span>
                </p>
              </div>
              <div>
                <p className="mb-1 text-xs text-muted">Level</p>
                <RiskBadge level={level} />
              </div>
              <div>
                <p className="mb-1 text-xs text-muted">Decision</p>
                <DecisionBadge decision={decision} />
              </div>
              <div>
                <p className="text-xs text-muted">Findings</p>
                <p className="tabular text-xl font-semibold">{findings.length}</p>
              </div>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={score ?? 0} aria-label="Risk score">
              <div className={`h-full ${level === "High" ? "bg-danger" : level === "Medium" ? "bg-[#f79009]" : "bg-success"}`} style={{ width: `${Math.max(2, score ?? 0)}%` }} />
            </div>
            <details className="rounded-lg border border-line">
              <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-[13px] font-medium text-info">
                <Calculator className="h-3.5 w-3.5" aria-hidden /> How this was calculated
              </summary>
              <div className="border-t border-line px-3 py-2 text-[13px]">
                {findings.length === 0 ? (
                  <p>No rule fired across R-01 … R-18 → score 0 → Low → AUTO_APPROVE.</p>
                ) : (
                  <ul className="space-y-1">
                    {findings.map((f) => (
                      <li key={f.ruleId} className="flex justify-between gap-3">
                        <span>
                          <span className="font-mono text-xs">{f.ruleId}</span> {f.anomalyType} <span className="text-muted">({f.riskLevel})</span>
                        </span>
                        <span className="tabular font-medium">+{f.points}</span>
                      </li>
                    ))}
                    <li className="flex justify-between gap-3 border-t border-line pt-1 font-medium">
                      <span>Total (capped at 100) · level = max(score band, highest severity)</span>
                      <span className="tabular">{score}</span>
                    </li>
                  </ul>
                )}
                <p className="mt-2 text-xs text-muted">Bands: 0–24 Low · 25–59 Medium · 60–100 High. High → ESCALATE, Medium → REVIEW, Low with zero findings → AUTO_APPROVE.</p>
              </div>
            </details>
            {narrative && (
              <p className="rounded-lg bg-slate-50 p-3 text-[13px] leading-relaxed text-slate-700">
                <span className="font-medium text-ink">Narrative: </span>
                {narrative}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Evidence({ json }: { json: string | null }) {
  if (!json) return null;
  let obj: Record<string, unknown> = {};
  try {
    obj = JSON.parse(json) as Record<string, unknown>;
  } catch {
    return <span className="text-xs text-muted">{json}</span>;
  }
  return (
    <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px]">
      {Object.entries(obj).map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="font-mono break-all">{Array.isArray(v) ? v.join("; ") : v === null ? "—" : String(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ExceptionsTable({ findings, analyzed, claimId, canHandle }: { findings: FindingRow[]; analyzed: boolean; claimId: string; canHandle: boolean }) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <ListChecks className="h-4 w-4 text-accent" aria-hidden /> Exceptions
          </CardTitle>
          <CardDescription>One row per rule finding, with evidence from SAP master data</CardDescription>
        </div>
      </CardHeader>
      {findings.length === 0 ? (
        <CardContent>
          <p className="text-[13px] text-muted">{analyzed ? "No exceptions raised — three-way match, policy and vendor checks passed." : "Not analyzed yet."}</p>
        </CardContent>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Anomaly type</TH>
              <TH>Risk level</TH>
              <TH>Rule</TH>
              <TH className="text-right">Points</TH>
              <TH>Message &amp; evidence</TH>
              <TH>Status</TH>
              <TH>Actions</TH>
            </TR>
          </THead>
          <TBody>
            {findings.map((f) => (
              <TR key={f.exceptionId} className="align-top">
                <TD className="font-medium whitespace-nowrap">{f.anomalyType}</TD>
                <TD>
                  <RiskBadge level={f.riskLevel} />
                </TD>
                <TD className="font-mono text-xs">{f.ruleId}</TD>
                <TD className="tabular text-right font-medium">+{f.points}</TD>
                <TD className="min-w-72">
                  <p>{f.message}</p>
                  <details>
                    <summary className="cursor-pointer text-xs text-info">Evidence</summary>
                    <Evidence json={f.evidence} />
                  </details>
                </TD>
                <TD>
                  <Badge tone={f.status === "Open" ? "amber" : f.status === "Resolved" ? "green" : "neutral"}>{f.status}</Badge>
                </TD>
                <TD>
                  {canHandle && f.status === "Open" ? (
                    <ExceptionActions claimId={claimId} exceptionId={f.exceptionId} anomalyType={f.anomalyType} message={f.message} />
                  ) : (
                    <span className="text-xs text-slate-400">—</span>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </Card>
  );
}

export function AuditTimeline({ entries }: { entries: { logId: string; timestamp: Date; actor: string; action: string; details: string }[] }) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <History className="h-4 w-4 text-accent" aria-hidden /> Audit Trail
          </CardTitle>
          <CardDescription>Append-only · newest first · times in ET</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="text-[13px] text-muted">No audit events yet.</p>
        ) : (
          <ol className="relative space-y-4 border-l border-line pl-5" data-testid="audit-trail">
            {entries.map((e) => (
              <li key={e.logId} className="relative">
                <span aria-hidden className={`absolute -left-[26px] top-1 h-3 w-3 rounded-full border-2 border-white ${e.actor === "AI-RPA Agent" ? "bg-accent" : "bg-slate-400"}`} />
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-semibold">{e.actor}</span>
                  <span className="text-[13px] font-medium text-navy-800">{e.action}</span>
                  <time dateTime={e.timestamp.toISOString()} className="tabular text-xs text-muted">
                    {formatEt(e.timestamp)}
                  </time>
                </div>
                <p className="mt-0.5 text-[13px] text-slate-700">{e.details}</p>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
