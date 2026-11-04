import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { deleteSession, tokenFromCookieHeader } from "@/lib/auth/session";
import { SESSION_COOKIE } from "@/lib/auth/constants";
import { clientIp, isSameOrigin, jsonError, newRequestId } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const requestId = newRequestId();
  if (!isSameOrigin(req)) return jsonError(403, "CROSS_ORIGIN", "Cross-origin requests are not allowed", requestId);

  const user = await deleteSession(tokenFromCookieHeader(req.headers.get("cookie")));
  if (user) {
    await prisma.auditLog.create({
      data: {
        logId: randomUUID(),
        actor: user.name,
        action: "User Signed Out",
        details: `${user.name} signed out.`,
        metadata: JSON.stringify({ requestId, ip: clientIp(req) }),
      },
    });
  }

  const res = NextResponse.json({ signedOut: true }, { status: 200, headers: { "x-request-id": requestId } });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0, secure: process.env.NODE_ENV === "production" });
  return res;
}
