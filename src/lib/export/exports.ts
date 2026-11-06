import "server-only";
import { prisma } from "@/lib/db";
import { toCents } from "@/lib/domain/money";
import type { ClaimFilters } from "@/lib/domain/schemas";
import { claimWhere, dataAnchor, resolvePeriod, withPeriod } from "@/lib/kpi/queries";
import { auditWhere, type AuditFilters } from "@/lib/audit/filters";
import { EXPORT_ROW_CAP, capRows, csvDate, csvDateTime, csvMoney, toCsv } from "./csv";

// Filter-aware CSV exports (Task 8, 9.4). The claim filter is exactly the /claims list's (claimWhere + withPeriod
// over the same resolved period), so the export contains the rows the list shows, all pages, up to the cap.

export const CLAIM_COLUMNS = ["claim_id", "employee", "department", "project_code", "category", "vendor_name", "invoice_number", "po_number", "amount_usd", "currency", "status", "decision", "risk_score", "risk_level", "submitted_at_utc", "analyzed_at_utc", "posted_at_utc"];
export const AUDIT_COLUMNS = ["timestamp_utc", "actor", "action", "claim_id", "details"];

export async function claimsCsv(filters: ClaimFilters, cap = EXPORT_ROW_CAP): Promise<{ csv: string; rows: number; truncated: boolean }> {
  const period = resolvePeriod(filters, await dataAnchor());
  const claims = await prisma.claim.findMany({
    where: withPeriod(claimWhere(filters), period.from, period.to),
    orderBy: [{ submittedAt: "desc" }, { claimId: "desc" }],
    take: cap + 1,
  });
  const rows = claims.map((c) => [
    c.claimId,
    c.employee,
    c.department,
    c.projectCode,
    c.category,
    c.vendorName,
    c.invoiceNumber,
    c.poNumber,
    csvMoney(toCents(c.amount)),
    c.currency,
    c.status,
    c.decision,
    c.riskScore,
    c.riskLevel,
    csvDateTime(c.submittedAt),
    csvDateTime(c.analyzedAt),
    csvDateTime(c.postedAt),
  ]);
  return { csv: toCsv(CLAIM_COLUMNS, capRows(rows, cap)), rows: Math.min(rows.length, cap), truncated: rows.length > cap };
}

export async function auditCsv(filters: AuditFilters, cap = EXPORT_ROW_CAP): Promise<{ csv: string; rows: number; truncated: boolean }> {
  const logs = await prisma.auditLog.findMany({ where: auditWhere(filters), orderBy: { timestamp: "desc" }, take: cap + 1 });
  const rows = logs.map((l) => [csvDateTime(l.timestamp), l.actor, l.action, l.claimId, l.details]);
  return { csv: toCsv(AUDIT_COLUMNS, capRows(rows, cap)), rows: Math.min(rows.length, cap), truncated: rows.length > cap };
}

export const exportFilename = (kind: "claims" | "audit-log", now = new Date()) => `${kind}-${csvDate(now)}.csv`;
