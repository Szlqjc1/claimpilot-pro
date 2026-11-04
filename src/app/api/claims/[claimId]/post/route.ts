import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { claimIdSchema } from "@/lib/domain/schemas";
import { AuditError } from "@/lib/audit/run-audit";
import { postClaim } from "@/lib/audit/disposition";
import { isSameOrigin, jsonError, newRequestId, rateLimit } from "@/lib/api";
import { requireUser } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ claimId: string }> }) {
  const requestId = newRequestId();
  if (!(await requireUser({ api: true }))) return jsonError(401, "UNAUTHENTICATED", "Sign in to continue", requestId);
  const parsed = claimIdSchema.safeParse((await params).claimId);
  if (!parsed.success) return jsonError(400, "INVALID_CLAIM_ID", "Invalid claim ID", requestId);
  if (!isSameOrigin(req)) return jsonError(403, "CROSS_ORIGIN", "Cross-origin requests are not allowed", requestId);
  const claimId = parsed.data;
  if (!rateLimit(`post:${claimId}`, 5)) return jsonError(429, "RATE_LIMITED", "Too many posting requests for this claim; try again in a minute", requestId);

  try {
    const result = await postClaim(claimId, { requestId, revalidate: (paths) => paths.forEach((p) => revalidatePath(p)) });
    return NextResponse.json(result, { status: 200, headers: { "x-request-id": requestId } });
  } catch (err) {
    if (err instanceof AuditError) return jsonError(err.status, err.code, err.message, requestId, err.extra);
    console.error(JSON.stringify({ evt: "post.error", requestId, claimId, error: err instanceof Error ? err.message : "unknown" }));
    return jsonError(500, "INTERNAL", "Posting failed unexpectedly; the claim was not posted", requestId);
  }
}
