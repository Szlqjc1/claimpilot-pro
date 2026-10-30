"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, Inbox } from "lucide-react";
import { formatUsd } from "@/lib/domain/money";
import { formatEtDate } from "@/lib/domain/dates";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { RiskBadge, StatusBadge } from "./badges";

export type ClaimListRow = {
  claimId: string;
  employee: string;
  department: string;
  projectCode: string | null;
  category: string;
  amountCents: number;
  status: string;
  riskLevel: string | null;
  vendorName: string;
  submittedAt: string;
};

/**
 * Required List block. The whole row is clickable for mouse users; keyboard users reach the
 * same destination through the Claim_ID and View Details links (no nested interactive roles).
 */
export function ClaimsTable({ rows }: { rows: ClaimListRow[] }) {
  const router = useRouter();
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
        <Inbox className="h-8 w-8 text-slate-300" aria-hidden />
        <p className="font-medium">No claims match these filters</p>
        <p className="text-[13px] text-muted">Try widening the date range or clearing a filter.</p>
      </div>
    );
  }
  return (
    <Table>
      <THead>
        <TR>
          <TH className="sticky left-0 z-10 bg-slate-50">Claim_ID</TH>
          <TH>Employee</TH>
          <TH>Department</TH>
          <TH>Project_Code</TH>
          <TH className="text-right">Amount</TH>
          <TH>Status</TH>
          <TH>Risk</TH>
          <TH>
            <span className="sr-only">Actions</span>
          </TH>
        </TR>
      </THead>
      <TBody>
        {rows.map((r) => (
          <TR key={r.claimId} onClick={() => router.push(`/claims/${r.claimId}`)} className="group cursor-pointer hover:bg-orange-50/40">
            <TD className="sticky left-0 z-10 bg-white group-hover:bg-orange-50/40">
              <Link href={`/claims/${r.claimId}`} onClick={(e) => e.stopPropagation()} className="font-mono text-[13px] font-medium text-navy-900 underline-offset-2 hover:underline">
                {r.claimId}
              </Link>
              <div className="text-[11px] text-muted">{formatEtDate(r.submittedAt)}</div>
            </TD>
            <TD>
              <div className="font-medium">{r.employee}</div>
              <div className="max-w-56 truncate text-[11px] text-muted">{r.vendorName}</div>
            </TD>
            <TD className="whitespace-nowrap">{r.department}</TD>
            <TD className="whitespace-nowrap font-mono text-[12px]">{r.projectCode ?? <span className="text-slate-400">—</span>}</TD>
            <TD className="tabular whitespace-nowrap text-right font-medium">{formatUsd(r.amountCents)}</TD>
            <TD>
              <StatusBadge status={r.status} />
            </TD>
            <TD>
              <RiskBadge level={r.riskLevel} />
            </TD>
            <TD className="text-right">
              <Link
                href={`/claims/${r.claimId}`}
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-[13px] font-medium text-info hover:bg-blue-50"
              >
                View Details <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                <span className="sr-only">for {r.claimId}</span>
              </Link>
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
