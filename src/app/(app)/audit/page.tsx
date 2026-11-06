import type { Metadata } from "next";
import { Download } from "lucide-react";
import { prisma } from "@/lib/db";
import { auditWhere, parseAuditFilters } from "@/lib/audit/filters";
import { PageHeader } from "@/components/shell/page-header";
import { Card } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { Button, buttonVariants } from "@/components/ui/button";
import { Pagination } from "@/components/claims/pagination";
import { AuditLogTable } from "@/components/claims/audit-log-table";

export const metadata: Metadata = { title: "Audit Log" };

const PAGE = 25;

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = Object.fromEntries(Object.entries(await searchParams).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v || undefined]));
  const f = parseAuditFilters(raw);
  const where = auditWhere(f);
  const exportQs = new URLSearchParams(Object.entries(raw).filter((e): e is [string, string] => !!e[1] && e[0] !== "page")).toString();
  const [total, rows, actors, actions] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ where, orderBy: { timestamp: "desc" }, skip: (f.page - 1) * PAGE, take: PAGE }),
    prisma.auditLog.findMany({ distinct: ["actor"], select: { actor: true }, orderBy: { actor: "asc" } }),
    prisma.auditLog.findMany({ distinct: ["action"], select: { action: true }, orderBy: { action: "asc" } }),
  ]);

  return (
    <>
      <PageHeader title="Audit Log" subtitle="Append-only record of every submission, AI-RPA decision and SAP posting. Read-only — no edit or delete." />
      <Card className="mb-4 p-4">
        <form className="grid grid-cols-1 gap-3 sm:grid-cols-4 sm:items-end" action="/audit">
          <div>
            <Label htmlFor="a-actor">Actor</Label>
            <Select id="a-actor" name="actor" defaultValue={f.actor ?? ""}>
              <option value="">All actors</option>
              {actors.map((a) => (
                <option key={a.actor}>{a.actor}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="a-action">Action</Label>
            <Select id="a-action" name="action" defaultValue={f.action ?? ""}>
              <option value="">All actions</option>
              {actions.map((a) => (
                <option key={a.action}>{a.action}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="a-claim">Claim ID</Label>
            <Input id="a-claim" name="claim" defaultValue={f.claim ?? ""} placeholder="CLM-2026-0142" />
          </div>
          <div className="flex gap-2">
            <Button type="submit" variant="navy" className="flex-1">
              Apply filters
            </Button>
            {/* Filter-aware: the export carries the applied filters (all pages, up to 10 000 rows). */}
            <a href={`/api/audit/export${exportQs ? `?${exportQs}` : ""}`} download className={buttonVariants({ variant: "secondary" })}>
              <Download className="h-4 w-4" aria-hidden /> Export CSV
            </a>
          </div>
        </form>
      </Card>
      <Card>
        <AuditLogTable rows={rows.map((r) => ({ ...r, timestamp: r.timestamp.toISOString() }))} />
        <Pagination basePath="/audit" params={raw} page={f.page} pageCount={Math.max(1, Math.ceil(total / PAGE))} total={total} pageSize={PAGE} />
      </Card>
    </>
  );
}
