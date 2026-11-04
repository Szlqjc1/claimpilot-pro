"use client";

import { useState } from "react";
import Link from "next/link";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { formatEt } from "@/lib/domain/dates";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { auditActionTone, initiatedByOf } from "@/lib/audit/tone";

type Row = { logId: string; timestamp: string; actor: string; action: string; details: string; claimId: string | null; metadata: string | null };

function pretty(json: string | null) {
  if (!json) return "—";
  try {
    return JSON.stringify(JSON.parse(json), null, 2);
  } catch {
    return json;
  }
}

export function AuditLogTable({ rows }: { rows: Row[] }) {
  const [open, setOpen] = useState<Row | null>(null);
  if (rows.length === 0) return <p className="px-5 py-10 text-center text-[13px] text-muted">No audit events match these filters.</p>;
  return (
    <>
      <Table>
        <THead>
          <TR>
            <TH>Timestamp (ET)</TH>
            <TH>Actor</TH>
            <TH>Action</TH>
            <TH>Claim</TH>
            <TH>Details</TH>
            <TH>
              <span className="sr-only">Open</span>
            </TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((r) => (
            <TR key={r.logId}>
              <TD className="tabular whitespace-nowrap text-xs">{formatEt(r.timestamp)}</TD>
              <TD className="whitespace-nowrap font-medium">
                {r.actor}
                {(() => {
                  const by = initiatedByOf(r.metadata);
                  return by && by !== r.actor ? <span className="block text-[11px] font-normal text-muted">initiated by {by}</span> : null;
                })()}
              </TD>
              <TD className="whitespace-nowrap">
                <Badge tone={auditActionTone(r.action)}>{r.action}</Badge>
              </TD>
              <TD className="whitespace-nowrap font-mono text-xs">
                {r.claimId ? (
                  <Link href={`/claims/${r.claimId}`} className="text-info hover:underline">
                    {r.claimId}
                  </Link>
                ) : (
                  "—"
                )}
              </TD>
              <TD className="max-w-[520px] truncate" title={r.details}>
                {r.details}
              </TD>
              <TD>
                <button type="button" onClick={() => setOpen(r)} className="rounded-md px-2 py-1 text-[13px] font-medium text-info hover:bg-blue-50">
                  Details<span className="sr-only"> for event at {formatEt(r.timestamp)}</span>
                </button>
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
      <Dialog.Root open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30" />
          <Dialog.Content className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col overflow-y-auto bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <Dialog.Title className="font-semibold">Audit event</Dialog.Title>
              <Dialog.Close aria-label="Close details" className="grid h-8 w-8 place-items-center rounded-lg hover:bg-slate-100">
                <X className="h-4 w-4" aria-hidden />
              </Dialog.Close>
            </div>
            <Dialog.Description className="sr-only">Read-only details of one audit log entry</Dialog.Description>
            {open && (
              <dl className="space-y-3 px-5 py-4 text-[13px]">
                {(
                  [
                    ["Log_ID", open.logId],
                    ["Timestamp", `${formatEt(open.timestamp, "MMM d, yyyy h:mm:ss a")} (${open.timestamp} UTC)`],
                    ["Actor", open.actor],
                    ["Action", open.action],
                    ["Claim_ID", open.claimId ?? "—"],
                    ["Details", open.details],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-xs text-muted">{k}</dt>
                    <dd className="break-words">{v}</dd>
                  </div>
                ))}
                <div>
                  <dt className="text-xs text-muted">Metadata</dt>
                  <dd>
                    <pre className="mt-1 overflow-auto rounded-lg bg-slate-950 p-3 text-[11px] text-slate-100">{pretty(open.metadata)}</pre>
                  </dd>
                </div>
              </dl>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
