import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { claimIdSchema } from "@/lib/domain/schemas";
import { AuditError, runAudit } from "@/lib/audit/run-audit";
import { isSameOrigin, jsonError, newRequestId, rateLimit } from "@/lib/api";
import { requireUser } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ claimId: string }> }) {
  const requestId = newRequestId();
  const user = await requireUser({ api: true });
  if (!user) return jsonError(401, "UNAUTHENTICATED", "Sign in to continue", requestId);
  const { claimId: rawId } = await params;
  const parsed = claimIdSchema.safeParse(rawId);
  if (!parsed.success) return jsonError(400, "INVALID_CLAIM_ID", "Invalid claim ID", requestId);
  if (!isSameOrigin(req)) return jsonError(403, "CROSS_ORIGIN", "Cross-origin requests are not allowed", requestId);
  const claimId = parsed.data;
  if (!rateLimit(`audit:${claimId}`)) return jsonError(429, "RATE_LIMITED", "Too many audit requests for this claim; try again in a minute", requestId);

  const key = req.headers.get("idempotency-key");
  if (key !== null && !/^[A-Za-z0-9_.:-]{8,100}$/.test(key)) return jsonError(400, "INVALID_IDEMPOTENCY_KEY", "Idempotency-Key must be 8–100 URL-safe characters", requestId);

  try {
    const result = await runAudit(claimId, {
      requestId,
      idempotencyKey: key,
      initiatedBy: user.name,
      revalidate: (paths) => paths.forEach((p) => revalidatePath(p)),
    });
    return NextResponse.json(result, { status: 200, headers: { "x-request-id": requestId } });
  } catch (err) {
    if (err instanceof AuditError) return jsonError(err.status, err.code, err.message, requestId, err.extra);
    console.error(JSON.stringify({ evt: "audit.error", requestId, claimId, error: err instanceof Error ? err.message : "unknown" }));
    return jsonError(500, "INTERNAL", "Audit failed unexpectedly; the claim was left Pending", requestId);
  }
}
