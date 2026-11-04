import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { claimIdSchema } from "@/lib/domain/schemas";
import { AuditError } from "@/lib/audit/run-audit";
import { dispositionException } from "@/lib/audit/disposition";
import { isSameOrigin, jsonError, newRequestId, rateLimit } from "@/lib/api";
import { requireUser } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const exceptionIdSchema = z.string().regex(/^EXC-\d{4}-\d{4}-R-\d{2}$/, "Invalid exception ID");
const bodySchema = z.object({
  status: z.enum(["Resolved", "Waived"]),
  note: z.string().trim().min(10).max(500),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ claimId: string; exceptionId: string }> }) {
  const requestId = newRequestId();
  if (!(await requireUser({ api: true }))) return jsonError(401, "UNAUTHENTICATED", "Sign in to continue", requestId);
  const p = await params;
  const claim = claimIdSchema.safeParse(p.claimId);
  if (!claim.success) return jsonError(400, "INVALID_CLAIM_ID", "Invalid claim ID", requestId);
  const exception = exceptionIdSchema.safeParse(p.exceptionId);
  if (!exception.success) return jsonError(400, "INVALID_EXCEPTION_ID", "Invalid exception ID", requestId);
  if (!isSameOrigin(req)) return jsonError(403, "CROSS_ORIGIN", "Cross-origin requests are not allowed", requestId);
  if (!rateLimit(`exception:${claim.data}`, 10)) return jsonError(429, "RATE_LIMITED", "Too many requests for this claim; try again in a minute", requestId);

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return jsonError(400, "INVALID_BODY", "Expected a JSON body", requestId);
  }
  const body = bodySchema.safeParse(raw);
  if (!body.success) {
    return jsonError(400, "VALIDATION_FAILED", body.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), requestId);
  }

  try {
    const result = await dispositionException(claim.data, exception.data, body.data, {
      requestId,
      revalidate: (paths) => paths.forEach((path) => revalidatePath(path)),
    });
    return NextResponse.json(result, { status: 200, headers: { "x-request-id": requestId } });
  } catch (err) {
    if (err instanceof AuditError) return jsonError(err.status, err.code, err.message, requestId, err.extra);
    console.error(JSON.stringify({ evt: "exception.error", requestId, claimId: claim.data, error: err instanceof Error ? err.message : "unknown" }));
    return jsonError(500, "INTERNAL", "Updating the exception failed unexpectedly", requestId);
  }
}
