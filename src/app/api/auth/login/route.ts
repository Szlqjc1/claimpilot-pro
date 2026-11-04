import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { DUMMY_HASH, verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { SESSION_COOKIE } from "@/lib/auth/constants";
import { clientIp, isSameOrigin, isSecureRequest, jsonError, newRequestId, rateLimit } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(200),
});

const INVALID = "Invalid email or password.";

export async function POST(req: Request) {
  const requestId = newRequestId();
  if (!isSameOrigin(req)) return jsonError(403, "CROSS_ORIGIN", "Cross-origin requests are not allowed", requestId);
  const ip = clientIp(req);

  // Throttling (DECISIONS D-32). All checks run before the user lookup and before scrypt, and all
  // answer the same 429. Only the account bucket is keyed on something the client cannot rotate freely.
  let raw: unknown = undefined;
  const throttled = async (bucket: "global" | "ip" | "account", key: string, email?: string) => {
    // At most one audit row per bucket key per minute, so a flood cannot turn into a flood of writes.
    if (rateLimit(`login:throttle-log:${key}`, 1)) {
      if (email === undefined) {
        // Best effort, only when logging: the body has not been read yet for the global/IP buckets.
        const parsed = await req.json().catch(() => null);
        const candidate = (parsed as { email?: unknown } | null)?.email;
        email = typeof candidate === "string" ? candidate.trim().toLowerCase().slice(0, 254) : "an unknown account";
      }
      await prisma.auditLog.create({
        data: { logId: randomUUID(), actor: "Authentication", action: "Sign-in Throttled", details: `Throttled sign-in attempt for ${email}.`, metadata: JSON.stringify({ requestId, ip, bucket }) },
      });
    }
    return jsonError(429, "RATE_LIMITED", "Too many sign-in attempts; try again in a minute", requestId);
  };

  // 1. Global ceiling: exists only to bound CPU (each non-throttled attempt costs a DB lookup plus one
  //    scrypt), so it is set well above real usage. Brute force is stopped by the account bucket (D-33).
  if (!rateLimit("login:global", 1000)) return throttled("global", "login:global");
  // 2. Per IP: coarse throttle; X-Forwarded-For is client-supplied, so this one alone is spoofable.
  if (!rateLimit(`login:ip:${ip}`, 5)) return throttled("ip", `login:ip:${ip}`);

  try {
    raw = await req.json();
  } catch {
    return jsonError(400, "INVALID_BODY", "Expected a JSON body", requestId);
  }
  const body = bodySchema.safeParse(raw);
  if (!body.success) return jsonError(400, "VALIDATION_FAILED", "Enter a valid email address and password.", requestId);

  const { email, password } = body.data;
  // 3. Per account, on the submitted (normalized) email, whether or not the account exists: cannot be
  //    spoofed and reveals nothing about which emails are real. 10/min so nobody can lock out a real user for long.
  if (!rateLimit(`login:acct:${email}`, 10)) return throttled("account", `login:acct:${email}`, email);

  const user = await prisma.user.findUnique({ where: { email } });
  // Always run scrypt so unknown emails and wrong passwords take similar time and get the same answer.
  const ok = verifyPassword(password, user?.passwordHash ?? DUMMY_HASH) && user !== null;
  const metadata = JSON.stringify({ requestId, ip });

  if (!ok || !user) {
    await prisma.auditLog.create({
      data: { logId: randomUUID(), actor: "Authentication", action: "Sign-in Failed", details: `Failed sign-in attempt for ${email}.`, metadata },
    });
    return jsonError(401, "INVALID_CREDENTIALS", INVALID, requestId);
  }

  const session = await createSession(user.id);
  await prisma.auditLog.create({
    data: { logId: randomUUID(), actor: user.name, action: "User Signed In", details: `${user.name} signed in (${user.role}).`, metadata },
  });

  const res = NextResponse.json({ user: { name: user.name, role: user.role } }, { status: 200, headers: { "x-request-id": requestId } });
  res.cookies.set(SESSION_COOKIE, session.token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: Math.round((session.expiresAt.getTime() - Date.now()) / 1000),
    secure: isSecureRequest(req),
  });
  return res;
}
