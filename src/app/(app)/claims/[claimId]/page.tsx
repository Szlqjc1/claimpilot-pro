import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { aiStatus } from "@/lib/ai/provider";
import { canReview, requireUser } from "@/lib/auth/session";
import { AlertTriangle, FolderKanban, Send } from "lucide-react";
import { prisma } from "@/lib/db";
import { claimIdSchema, parseExtractedData } from "@/lib/domain/schemas";
import { formatUsd, toCents } from "@/lib/domain/money";
import { formatEt } from "@/lib/domain/dates";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RiskBadge, StatusBadge } from "@/components/claims/badges";
import { ReceiptViewer } from "@/components/claims/receipt-viewer";
import { AiStructuredData } from "@/components/claims/ai-data";
import { AnnotatedInvoice, AuditTimeline, ExceptionsTable, LockedPlaceholder, RiskPanel } from "@/components/claims/panels";
import { AuditButton } from "@/components/claims/audit-button";
import { PostToSapButton } from "@/components/claims/post-to-sap";

export const dynamic = "force-dynamic";

type Params = Promise<{ claimId: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { claimId } = await params;
  return { title: `Claim ${claimId}` };
}

export default async function ClaimReviewPage({ params }: { params: Params }) {
  const { claimId: raw } = await params;
  const id = claimIdSchema.safeParse(raw);
  if (!id.success) notFound();
  const claim = await prisma.claim.findUnique({
    where: { claimId: id.data },
    include: {
      project: true,
      exceptions: { orderBy: { ruleId: "asc" } },
      auditLogs: { orderBy: { timestamp: "desc" } },
      aiRuns: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!claim) notFound();

  const amountCents = toCents(claim.amount);
  // AI blocks exist in the DOM only once the claim has been analyzed (Analyzed or Posted) — DECISIONS D-19.
  const showAi = claim.status !== "Pending";
  const lastRun = claim.aiRuns[0] ?? null;
  const openExceptions = claim.exceptions.filter((e) => e.status === "Open").length;
  // UI mirror of the server-side checks (D-27): reviewer/admin, and never on your own claim.
  const user = await requireUser();
  const reviewBlock = !canReview(user) ? "Only a reviewer or admin can resolve exceptions and post to SAP." : claim.employee === user.name ? "You submitted this claim, so another reviewer must resolve and post it." : null;
  const findings = claim.exceptions.map((e) => ({ exceptionId: e.exceptionId, ruleId: e.ruleId, anomalyType: e.anomalyType, riskLevel: e.riskLevel, points: e.points, message: e.message, status: e.status, evidence: e.evidence, resolvedBy: e.resolvedBy }));

  return (
    <article>
      <header className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-accent-strong">CLAIM REVIEW</p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">AI-RPA Automotive Expense Inspection</h1>
          <p className="mt-1 text-sm text-muted">
            <span className="font-mono font-medium text-ink">{claim.claimId}</span> · {claim.employee} · {claim.department} · submitted {formatEt(claim.submittedAt)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge status={claim.status} />
          {claim.riskLevel && <RiskBadge level={claim.riskLevel} score={claim.riskScore} />}
          <p className="tabular text-3xl font-semibold tracking-tight" aria-label={`Amount ${formatUsd(amountCents)}`}>
            {formatUsd(amountCents)}
          </p>
        </div>
      </header>

      {claim.source === "upload" && aiStatus().mode === "mock" && claim.status === "Pending" && (
        <div role="alert" className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[13px] text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>
            This upload cannot be audited in Demo AI mode (live OCR disabled). Use a seeded claim to see the full flow.{" "}
            <Link href="/claims/CLM-2026-0142" className="font-medium underline underline-offset-2">
              Open CLM-2026-0142 →
            </Link>
          </p>
        </div>
      )}

      {showAi && lastRun?.mode === "fallback" && (
        <div role="alert" className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[13px] text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          DeepSeek was unavailable for this audit; the deterministic fixture extraction was used (AI run mode: Fallback).
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.05fr_0.95fr]">
        {/* Left column */}
        <div className="min-w-0">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Original OEM/Supplier Invoice</p>
          <Card className="overflow-hidden">
            <ReceiptViewer
              src={`/api/receipts/${claim.claimId}/original`}
              mime={claim.receiptMime ?? "image/svg+xml"}
              alt={`Original invoice ${claim.invoiceNumber ?? ""} from ${claim.vendorName}`}
              meta={[
                { label: "File", value: claim.receiptName ?? "original.svg" },
                { label: "SHA-256", value: claim.receiptHash ? `${claim.receiptHash.slice(0, 12)}…` : "—" },
                { label: "Uploaded", value: formatEt(claim.createdAt < claim.submittedAt ? claim.createdAt : claim.submittedAt) },
                { label: "Vendor", value: claim.vendorName },
              ]}
            />
          </Card>
          <p className="mt-2 text-xs text-muted">SAMPLE — NOT A REAL INVOICE. Fictional vendor and tax data.</p>
        </div>

        {/* Right column */}
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FolderKanban className="h-4 w-4 text-accent" aria-hidden /> Project &amp; Category
              </CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-1 gap-x-5 gap-y-3 sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-muted">Project_Code</dt>
                  <dd className="font-mono font-semibold">{claim.projectCode ?? "—"}</dd>
                  {claim.project && <dd className="text-xs text-muted">{claim.project.name}</dd>}
                </div>
                <div>
                  <dt className="text-xs text-muted">Category</dt>
                  <dd className="font-semibold">{claim.category}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Vendor</dt>
                  <dd className="text-[13px] font-medium">{claim.vendorName}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Invoice number</dt>
                  <dd className="font-mono text-[13px]">{claim.invoiceNumber ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">PO number</dt>
                  <dd className="font-mono text-[13px]">{claim.poNumber ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Amount</dt>
                  <dd className="tabular text-[13px] font-semibold">{formatUsd(amountCents)}</dd>
                </div>
              </dl>
              {claim.project && (
                <p className="mt-3 flex flex-wrap gap-2 text-xs">
                  <Badge>{claim.project.customerProgram}</Badge>
                  <Badge tone={claim.project.status === "Active" ? "green" : "neutral"}>Project {claim.project.status}</Badge>
                </p>
              )}
            </CardContent>
          </Card>

          {showAi ? (
            <>
              <AiStructuredData result={parseExtractedData(claim.extractedData)} raw={claim.extractedData} />
              {claim.aiAnalyzedReceipt && <AnnotatedInvoice src={claim.aiAnalyzedReceipt} claimId={claim.claimId} />}
            </>
          ) : (
            <LockedPlaceholder />
          )}
        </div>
      </div>

      <Card className="no-print mt-6">
        <CardContent className="flex flex-col gap-4 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-semibold">AI-RPA audit</h2>
            <p id="audit-help" className="text-[13px] text-muted">
              Runs OCR, SAP three-way match, policy checks, and risk scoring. This action is recorded in the audit log.
            </p>
            {lastRun && (
              <p className="mt-1 text-xs text-muted">
                Last run: {lastRun.mode === "mock" ? "Demo AI" : lastRun.mode === "live" ? "DeepSeek live" : "Fallback"} · {lastRun.model} · {lastRun.latencyMs} ms · {lastRun.promptVersion}
              </p>
            )}
          </div>
          <AuditButton claimId={claim.claimId} status={claim.status} />
        </CardContent>
      </Card>

      {claim.status === "Analyzed" && (
        <Card className="no-print mt-4">
          <CardContent className="flex flex-col gap-4 py-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-semibold">Post to SAP</h2>
              <p id="post-help" className="text-[13px] text-muted">
                Open exceptions: <span className="tabular font-semibold text-ink">{openExceptions}</span>
                {reviewBlock
                  ? ` · ${reviewBlock}`
                  : openExceptions > 0
                    ? " · Resolve or waive all exceptions first."
                    : " · Ready to create the MIRO invoice document."}
              </p>
            </div>
            {!reviewBlock && (
              <PostToSapButton claimId={claim.claimId} openExceptions={openExceptions} amountLabel={formatUsd(amountCents)} />
            )}
          </CardContent>
        </Card>
      )}
      {claim.status === "Posted" && (
        <Card className="no-print mt-4">
          <CardContent className="flex flex-wrap items-center gap-3 py-4">
            <Send className="h-4 w-4 text-success" aria-hidden />
            <h2 className="font-semibold">Posted to SAP</h2>
            <p className="text-[13px] text-muted">
              Posted {formatEt(claim.postedAt)} · <span className="font-mono text-ink">{claim.miroDocNo ?? "—"}</span>
            </p>
          </CardContent>
        </Card>
      )}

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <RiskPanel status={claim.status} score={claim.riskScore} level={claim.riskLevel} decision={claim.decision} findings={findings} narrative={lastRun?.narrative ?? null} />
        <AuditTimeline entries={claim.auditLogs} />
      </div>
      <div className="mt-6">
        <ExceptionsTable findings={findings} analyzed={claim.status !== "Pending"} claimId={claim.claimId} canHandle={claim.status === "Analyzed" && !reviewBlock} />
      </div>
    </article>
  );
}
