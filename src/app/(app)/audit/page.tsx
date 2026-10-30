import type { Metadata } from "next";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shell/page-header";
import { Card } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Pagination } from "@/components/claims/pagination";
import { AuditLogTable } from "@/components/claims/audit-log-table";

export const metadata: Metadata = { title: "Audit Log" };

const PAGE = 25;
const schema = z.object({
  actor: z.string().max(60).optional().catch(undefined),
  action: z.string().max(60).optional().catch(undefined),
  claim: z.string().max(20).optional().catch(undefined),
  page: z.coerce.number().int().min(1).catch(1).default(1),
});

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = Object.fromEntries(Object.entries(await searchParams).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v || undefined]));
  const f = schema.parse(raw);
  const where: Prisma.AuditLogWhereInput = {};
  if (f.actor) where.actor = f.actor;
  if (f.action) where.action = f.action;
  if (f.claim) where.claimId = { contains: f.claim.toUpperCase() };
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
          <Button type="submit" variant="navy">
            Apply filters
          </Button>
        </form>
      </Card>
      <Card>
        <AuditLogTable rows={rows.map((r) => ({ ...r, timestamp: r.timestamp.toISOString() }))} />
        <Pagination basePath="/audit" params={raw} page={f.page} pageCount={Math.max(1, Math.ceil(total / PAGE))} total={total} pageSize={PAGE} />
      </Card>
    </>
  );
}
