import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { assessClaims } from "@/lib/economics/assess";
import { costCurveSvg } from "@/lib/economics/curve-svg";
import { CURVE_CAPACITIES, costCurve } from "@/lib/risk/economics";
import { CONSTRAINT_RULES, DEFAULT_ERROR_PROBABILITY, REVIEW_COST_CENTS } from "@/lib/domain/constants";
import { formatUsd } from "@/lib/domain/money";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ProvenanceBadge } from "@/components/claims/badges";

export const metadata: Metadata = { title: "Economics" };
export const dynamic = "force-dynamic";

const REASON_LABEL = { CONSTRAINT: "Constraint rule", EXPECTED_LOSS: "p·L > c", BELOW_COST: "p·L ≤ c" } as const;
const usd = (cents: number) => formatUsd(Math.round(cents));

export default async function EconomicsPage() {
  await requireUser();
  const claims = await assessClaims();
  const top = [...claims].sort((a, b) => b.priority - a.priority || b.exposureCents - a.exposureCents).slice(0, 10);
  const reviewed = claims.filter((c) => c.action === "REVIEW");
  const onModel = claims.filter((c) => c.extractionSource === "model").length;
  const leftOnTable = claims.filter((c) => c.action === "CLEAR").reduce((s, c) => s + c.expectedLossCents, 0);
  const points = costCurve(claims, REVIEW_COST_CENTS, CURVE_CAPACITIES);
  const best = points.reduce((a, b) => (b.totalCents < a.totalCents ? b : a), points[0]);
  const svg = claims.length ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(costCurveSvg(points))}` : null;

  return (
    <>
      <PageHeader eyebrow="REVIEW ECONOMICS" title="Economics" subtitle="Is reviewing a flagged claim worth the money? Review when p × L > c." />

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-[0.8fr_1.2fr]">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Assumptions</CardTitle>
              <CardDescription>Illustrative demo values (DECISIONS D-35), not measured estimates.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
              <div>
                <dt className="text-xs text-muted">Review cost c</dt>
                <dd className="tabular font-semibold">{formatUsd(REVIEW_COST_CENTS)} per claim</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Error probability p</dt>
                <dd className="tabular font-semibold">{(DEFAULT_ERROR_PROBABILITY * 100).toFixed(1)}%</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-xs text-muted">Always reviewed (constraints)</dt>
                <dd className="font-mono font-semibold">{CONSTRAINT_RULES.join(", ")}</dd>
              </div>
            </dl>
            <p className="mt-4 text-[13px] text-muted">
              L is the money at risk if a finding is ignored, capped at the invoice amount. These numbers rank work; they do not replace the risk score, which is unchanged.
              See <span className="font-mono">docs/ECONOMICS.md</span>.
            </p>
            <p className="mt-4 rounded-lg border border-line bg-slate-50 p-3 text-[13px]" data-testid="economics-aggregate">
              Under this policy, <span className="tabular font-semibold">{reviewed.length}</span> of <span className="tabular">{claims.length}</span> analyzed claims would be reviewed, costing{" "}
              <span className="tabular font-semibold">{formatUsd(reviewed.length * REVIEW_COST_CENTS)}</span>, leaving <span className="tabular font-semibold">{usd(leftOnTable)}</span> of expected loss on the
              table.
            </p>
            <p className="mt-2 text-xs text-muted" data-testid="economics-provenance">
              <span className="tabular font-semibold text-ink">{onModel}</span> of <span className="tabular">{claims.length}</span> analyzed claims were scored on a model extraction; the rest on the
              reference extraction.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Cost curve</CardTitle>
              <CardDescription>Same chart as docs/images/cost-curve.svg (written by pnpm cost:curve), drawn here from live data.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {svg ? (
              <figure>
                {/* eslint-disable-next-line @next/next/no-img-element -- generated inline SVG data URI */}
                <img src={svg} alt={`Review cost curve: lowest total cost ${formatUsd(best.totalCents)} at ${best.capacityPct}% review capacity`} className="h-auto w-full" />
                <figcaption className="mt-2 text-xs text-muted">
                  Reviewing the highest p·L/c claims first: total cost = review cost + expected loss left unreviewed. Lowest at {best.capacityPct}% capacity ({best.reviewed} of {claims.length} claims),{" "}
                  {formatUsd(best.totalCents)} vs {formatUsd(points[0].totalCents)} with no review.
                </figcaption>
              </figure>
            ) : (
              <p className="text-[13px] text-muted">No analyzed claims yet. Run an audit or `pnpm db:seed`.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Top 10 by priority (p·L / c)</CardTitle>
            <CardDescription>Analyzed claims, highest expected loss per review dollar first.</CardDescription>
          </div>
        </CardHeader>
        {top.length === 0 ? (
          <CardContent>
            <p className="text-[13px] text-muted">No analyzed claims.</p>
          </CardContent>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Claim</TH>
                <TH>Vendor</TH>
                <TH className="text-right">Amount</TH>
                <TH className="text-right">L</TH>
                <TH className="text-right">p·L</TH>
                <TH>Action</TH>
                <TH>Reason</TH>
              </TR>
            </THead>
            <TBody>
              {top.map((c) => (
                <TR key={c.claimId}>
                  <TD className="whitespace-nowrap font-mono text-xs">
                    <Link href={`/claims/${c.claimId}`} className="text-info hover:underline">
                      {c.claimId}
                    </Link>{" "}
                    <ProvenanceBadge source={c.extractionSource} />
                  </TD>
                  <TD className="max-w-[260px] truncate" title={c.vendorName}>
                    {c.vendorName}
                  </TD>
                  <TD className="tabular text-right">{formatUsd(c.amountCents)}</TD>
                  <TD className="tabular text-right">{formatUsd(c.exposureCents)}</TD>
                  <TD className="tabular text-right font-medium">{usd(c.expectedLossCents)}</TD>
                  <TD>
                    <Badge tone={c.action === "REVIEW" ? "amber" : "green"}>{c.action}</Badge>
                  </TD>
                  <TD className="whitespace-nowrap text-[13px]">{REASON_LABEL[c.reason]}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
