import { jsonError, newRequestId, rateLimit } from "@/lib/api";
import { requireUser } from "@/lib/auth/session";
import { parseAuditFilters } from "@/lib/audit/filters";
import { auditCsv, exportFilename } from "@/lib/export/exports";
import { csvHeaders } from "@/lib/export/csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** CSV of the audit log for actor / action / claim / from / to (all pages, capped). GET: no same-origin check. */
export async function GET(req: Request) {
  const requestId = newRequestId();
  const user = await requireUser({ api: true });
  if (!user) return jsonError(401, "UNAUTHENTICATED", "Sign in to continue", requestId);
  if (!rateLimit(`export:${user.id}`, 10)) return jsonError(429, "RATE_LIMITED", "Too many exports; try again in a minute", requestId);
  const filters = parseAuditFilters(Object.fromEntries(new URL(req.url).searchParams));
  const { csv } = await auditCsv(filters);
  return new Response(csv, { status: 200, headers: { ...csvHeaders(exportFilename("audit-log")), "x-request-id": requestId } });
}
