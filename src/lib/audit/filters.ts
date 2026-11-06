import { z } from "zod";
import type { Prisma } from "@prisma/client";

// Audit-log filters, shared by the /audit page and GET /api/audit/export so the two can never disagree.

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const auditFiltersSchema = z.object({
  actor: z.string().max(60).optional().catch(undefined),
  action: z.string().max(60).optional().catch(undefined),
  claim: z.string().max(20).optional().catch(undefined),
  from: isoDay.optional().catch(undefined),
  to: isoDay.optional().catch(undefined),
  page: z.coerce.number().int().min(1).catch(1).default(1),
});
export type AuditFilters = z.infer<typeof auditFiltersSchema>;

/** Empty strings and arrays from URLSearchParams / Next searchParams become undefined before parsing. */
export function parseAuditFilters(raw: Record<string, string | string[] | undefined>): AuditFilters {
  return auditFiltersSchema.parse(Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, (Array.isArray(v) ? v[0] : v) || undefined])));
}

/** `from` / `to` are inclusive UTC calendar days. */
export function auditWhere(f: AuditFilters): Prisma.AuditLogWhereInput {
  const where: Prisma.AuditLogWhereInput = {};
  if (f.actor) where.actor = f.actor;
  if (f.action) where.action = f.action;
  if (f.claim) where.claimId = { contains: f.claim.toUpperCase() };
  if (f.from || f.to) {
    where.timestamp = {
      ...(f.from ? { gte: new Date(`${f.from}T00:00:00Z`) } : {}),
      ...(f.to ? { lt: new Date(Date.parse(`${f.to}T00:00:00Z`) + 86_400_000) } : {}),
    };
  }
  return where;
}
