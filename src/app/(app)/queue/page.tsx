import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { loadQueue, QUEUE_STAGES, type QueueGroups, type QueueRow, type QueueStage } from "@/lib/queue";
import { formatUsd } from "@/lib/domain/money";
import { formatEt } from "@/lib/domain/dates";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { buttonVariants } from "@/components/ui/button";
import { DecisionBadge, ProvenanceBadge, RiskBadge } from "@/components/claims/badges";

export const metadata: Metadata = { title: "Queue" };
export const dynamic = "force-dynamic";

const ACTION: Record<QueueStage, string> = { pending: "Audit", disposition: "Review", ready: "Post" };

function Rows({ rows, stage, readOnly, empty }: { rows: QueueRow[]; stage: QueueStage; readOnly: boolean; empty: string }) {
  if (rows.length === 0) return <p className="px-5 py-6 text-[13px] text-muted">{empty}</p>;
  return (
    <Table>
      <THead>
        <TR>
          <TH>Claim</TH>
          <TH>Vendor</TH>
          <TH className="text-right">Amount</TH>
          <TH>Risk</TH>
          <TH>Decision</TH>
          <TH>Routed to</TH>
          <TH>
            <span className="sr-only">Action</span>
          </TH>
        </TR>
      </THead>
      <TBody>
        {rows.map((r) => (
          <TR key={r.claimId}>
            <TD className="whitespace-nowrap">
              <span className="font-mono text-xs font-medium">{r.claimId}</span> <ProvenanceBadge source={r.extractionSource} />
              <span className="block text-[11px] text-muted">
                {r.employee} · {formatEt(r.submittedAt)}
              </span>
            </TD>
            <TD className="max-w-[260px] truncate" title={r.vendorName}>
              {r.vendorName}
            </TD>
            <TD className="tabular text-right font-medium">{formatUsd(r.amountCents)}</TD>
            <TD>
              <RiskBadge level={r.riskLevel} score={r.riskScore} />
            </TD>
            <TD>{r.decision ? <DecisionBadge decision={r.decision} /> : <span className="text-xs text-slate-400">—</span>}</TD>
            <TD className="whitespace-nowrap text-[13px]">{r.assignedTo ?? r.assignedRole ?? <span className="text-xs text-slate-400">—</span>}</TD>
            <TD className="text-right">
              <Link href={`/claims/${r.claimId}`} className={buttonVariants({ variant: readOnly ? "secondary" : "primary", size: "sm" })}>
                {readOnly ? "View" : ACTION[stage]}
                <span className="sr-only"> {r.claimId}</span>
              </Link>
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

function Section({ id, title, description, groups, readOnly, pendingNote }: { id: string; title: string; description: string; groups: QueueGroups; readOnly: boolean; pendingNote?: string }) {
  const total = QUEUE_STAGES.reduce((n, s) => n + groups[s.stage].length, 0);
  return (
    <section aria-labelledby={id} className="mb-8">
      <h2 id={id} className="mb-1 text-lg font-semibold tracking-tight">
        {title} <span className="tabular text-sm font-normal text-muted">· {total}</span>
      </h2>
      <p className="mb-3 text-[13px] text-muted">{description}</p>
      <div className="flex flex-col gap-4">
        {QUEUE_STAGES.map(({ stage, title: stageTitle, empty }) => (
          <Card key={stage} data-testid={`${id}-${stage}`}>
            <CardHeader>
              <div>
                <CardTitle>
                  {stageTitle} <span className="tabular text-[13px] font-normal text-muted">· {groups[stage].length}</span>
                </CardTitle>
                {stage === "pending" && pendingNote && <CardDescription>{pendingNote}</CardDescription>}
              </div>
            </CardHeader>
            <Rows rows={groups[stage]} stage={stage} readOnly={readOnly} empty={empty} />
          </Card>
        ))}
      </div>
    </section>
  );
}

export default async function QueuePage() {
  const user = await requireUser();
  const queue = await loadQueue(user);
  return (
    <>
      <PageHeader
        eyebrow="WORK QUEUE"
        title="Queue"
        subtitle={queue.mode === "reviewer" ? `Claims routed to ${user.name}, plus unassigned work.` : "Your submissions (read-only)."}
      />
      {queue.mode === "reviewer" ? (
        <>
          <Section
            id="queue-mine"
            title="Assigned to you"
            description="Flagged claims routed to you: department → role → owner."
            groups={queue.mine}
            readOnly={false}
            pendingNote="Claims are assigned when the audit flags them, so this group is usually empty."
          />
          <Section
            id="queue-unassigned"
            title="Unassigned"
            description="No owner yet: not audited, clean, or submitted by the role owner. Your own submissions are not listed."
            groups={queue.unassigned}
            readOnly={false}
          />
        </>
      ) : (
        <Section id="queue-own" title="Your submissions" description="Reviewers resolve exceptions and post to SAP; follow progress here." groups={queue.mine} readOnly />
      )}
    </>
  );
}
