import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { APPROVAL_MATRIX, ENTERTAINMENT_POLICY, TRAVEL_POLICY } from "@/lib/domain/constants";
import { formatUsd, toCents } from "@/lib/domain/money";
import { toIsoDate } from "@/lib/domain/dates";
import { aiStatus } from "@/lib/ai/provider";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = { title: "Policies & Data" };

const yes = (b: boolean) => (b ? <Badge tone="blue">Required</Badge> : <span className="text-muted">—</span>);

export default async function PoliciesPage() {
  const [policies, benchmarks, pos, vendors] = await Promise.all([
    prisma.policy.findMany(),
    prisma.benchmark.findMany({ orderBy: [{ category: "asc" }, { itemCode: "asc" }] }),
    prisma.purchaseOrder.findMany({ where: { poNumber: { lt: "4501000" } }, include: { vendor: true }, orderBy: { poNumber: "asc" } }),
    prisma.vendor.findMany({ orderBy: { name: "asc" } }),
  ]);
  const ai = aiStatus();
  return (
    <>
      <PageHeader title="Policies & Data" subtitle="Read-only view of the rules and SAP master data the AI-RPA agent checks against." />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Category limits</CardTitle>
              <CardDescription>Used by R-01, R-04, R-05, R-07 · edit in src/lib/seed/master.ts</CardDescription>
            </div>
          </CardHeader>
          <Table>
            <THead>
              <TR>
                <TH>Category</TH>
                <TH className="text-right">Per-claim limit</TH>
                <TH>PO</TH>
                <TH>GRN</TH>
                <TH>Project code</TH>
              </TR>
            </THead>
            <TBody>
              {policies.map((p) => (
                <TR key={p.category}>
                  <TD>
                    <p className="font-medium">{p.category}</p>
                    <p className="max-w-md text-xs text-muted">{p.notes}</p>
                  </TD>
                  <TD className="tabular text-right font-medium">{formatUsd(toCents(p.perClaimLimit))}</TD>
                  <TD>{yes(p.requiresPo)}</TD>
                  <TD>{yes(p.requiresGrn)}</TD>
                  <TD>{yes(p.requiresProjectCode)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Approval matrix</CardTitle>
                <CardDescription>R-15 Approval Threshold Breach</CardDescription>
              </div>
            </CardHeader>
            <Table>
              <TBody>
                {APPROVAL_MATRIX.map((r) => (
                  <TR key={r.level}>
                    <TD className="tabular">{r.label}</TD>
                    <TD className="font-medium">{r.level}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Travel &amp; entertainment</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-[13px]">
              <p>Lodging cap {formatUsd(TRAVEL_POLICY.lodgingCapPerNightCents)}/night · airfare cap {formatUsd(TRAVEL_POLICY.airfareCapCents)} domestic · per diem {formatUsd(TRAVEL_POLICY.perDiemCents)}/day · economy only (R-11)</p>
              <p>Entertainment {formatUsd(ENTERTAINMENT_POLICY.perHeadCapCents)}/head · alcohol discouraged · attendee list required (R-12)</p>
              <p>Capitalization threshold $5,000 for tooling and software (R-18)</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>AI mode &amp; environment</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-2 text-[13px]">
                <dt className="text-muted">AI_MODE</dt>
                <dd className="font-mono">{ai.mode}</dd>
                <dt className="text-muted">Provider status</dt>
                <dd>
                  <Badge tone={ai.mode === "mock" ? "neutral" : ai.configured ? "green" : "red"}>{ai.label}</Badge>
                </dd>
                <dt className="text-muted">Model</dt>
                <dd className="font-mono">{ai.model}</dd>
                <dt className="text-muted">OCR_MODE</dt>
                <dd className="font-mono">{ai.ocrMode}</dd>
                <dt className="text-muted">API key</dt>
                <dd>{ai.mode === "live" ? (ai.configured ? "Set (server-side only)" : "Missing") : "Not required"}</dd>
              </dl>
              <p className="mt-3 text-xs text-muted">DeepSeek is called from the server only. The default chat model is text-only: OCR runs first and only text is sent.</p>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <div>
            <CardTitle>Open SAP purchase orders</CardTitle>
            <CardDescription>Remaining = amount − previously consumed (current invoice not yet applied) · R-07</CardDescription>
          </div>
        </CardHeader>
        <Table>
          <THead>
            <TR>
              <TH>PO</TH>
              <TH>Vendor</TH>
              <TH>Project</TH>
              <TH>GL coding</TH>
              <TH className="text-right">Amount</TH>
              <TH className="text-right">Consumed</TH>
              <TH className="text-right">Remaining</TH>
              <TH>Status</TH>
            </TR>
          </THead>
          <TBody>
            {pos.map((p) => (
              <TR key={p.poNumber}>
                <TD className="font-mono">{p.poNumber}</TD>
                <TD>{p.vendor.name}</TD>
                <TD className="font-mono text-xs">{p.projectCode}</TD>
                <TD>{p.costType}</TD>
                <TD className="tabular text-right">{formatUsd(toCents(p.amount))}</TD>
                <TD className="tabular text-right">{formatUsd(toCents(p.consumedAmount))}</TD>
                <TD className="tabular text-right font-medium">{formatUsd(toCents(p.amount) - toCents(p.consumedAmount))}</TD>
                <TD>
                  <Badge tone={p.status === "Open" ? "green" : p.status === "On Hold" ? "amber" : "neutral"}>{p.status}</Badge>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Price benchmarks</CardTitle>
              <CardDescription>R-08: &gt;15% over p50 = 15 pts, &gt;30% = 25 pts</CardDescription>
            </div>
          </CardHeader>
          <Table>
            <THead>
              <TR>
                <TH>Item</TH>
                <TH>Unit</TH>
                <TH className="text-right">p50</TH>
                <TH className="text-right">p90</TH>
              </TR>
            </THead>
            <TBody>
              {benchmarks.map((b) => (
                <TR key={b.itemCode}>
                  <TD>
                    <span className="font-mono text-xs">{b.itemCode}</span>
                    <span className="block text-xs text-muted">{b.description}</span>
                  </TD>
                  <TD>{b.unit}</TD>
                  <TD className="tabular text-right">{formatUsd(toCents(b.p50))}</TD>
                  <TD className="tabular text-right">{formatUsd(toCents(b.p90))}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Vendor master</CardTitle>
              <CardDescription>R-06 approval / W-9 / insurance · R-17 bank details (last 4 only)</CardDescription>
            </div>
          </CardHeader>
          <Table>
            <THead>
              <TR>
                <TH>Vendor</TH>
                <TH>Status</TH>
                <TH>W-9 expires</TH>
                <TH>Bank</TH>
              </TR>
            </THead>
            <TBody>
              {vendors.map((v) => {
                const expired = v.w9ExpiresAt && v.w9ExpiresAt < new Date("2026-10-29");
                return (
                  <TR key={v.vendorId}>
                    <TD>
                      <p className="font-medium">{v.name}</p>
                      <p className="text-xs text-muted">
                        {v.city}, {v.state} · EIN {v.taxId} · {v.paymentTerms}
                      </p>
                    </TD>
                    <TD>{v.approved ? <Badge tone="green">Approved</Badge> : <Badge tone="red">Not approved</Badge>}</TD>
                    <TD className={expired || !v.w9OnFile ? "text-danger" : ""}>{v.w9OnFile ? (v.w9ExpiresAt ? toIsoDate(v.w9ExpiresAt) : "—") : "No W-9"}</TD>
                    <TD className="text-xs">
                      {v.bankName} ••{v.bankAccountLast4}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </Card>
      </div>
    </>
  );
}
