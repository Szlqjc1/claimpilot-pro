import "server-only";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { readEnv } from "@/lib/env";
import { SESSION_COOKIE } from "./constants";

// Revocable, DB-backed sessions. The middleware only checks that the cookie exists;
// this module is what actually validates the token.

export type SessionUser = { id: string; name: string; email: string; role: string };
export type Session = { token: string; expiresAt: Date; user: SessionUser };

export async function createSession(userId: string, now = new Date()): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + readEnv().SESSION_TTL_HOURS * 3_600_000);
  await prisma.session.create({ data: { token, userId, expiresAt, createdAt: now } });
  return { token, expiresAt };
}

/** Look up a token; expired rows are deleted and treated as no session. */
export async function getSessionByToken(token: string | null | undefined, now = new Date()): Promise<Session | null> {
  if (!token || token.length > 200) return null;
  const row = await prisma.session.findUnique({
    where: { token },
    include: { user: { select: { id: true, name: true, email: true, role: true } } },
  });
  if (!row) return null;
  if (row.expiresAt.getTime() <= now.getTime()) {
    await prisma.session.deleteMany({ where: { token } });
    return null;
  }
  return { token: row.token, expiresAt: row.expiresAt, user: row.user };
}

export async function deleteSession(token: string | null | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  const row = await prisma.session.findUnique({ where: { token }, include: { user: { select: { id: true, name: true, email: true, role: true } } } });
  await prisma.session.deleteMany({ where: { token } });
  return row?.user ?? null;
}

/** Session for the current request, from the cp_session cookie. */
export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  return getSessionByToken(jar.get(SESSION_COOKIE)?.value);
}

/**
 * Pages: `await requireUser()` redirects to /login when there is no valid session.
 * API routes: `await requireUser({ api: true })` returns null so the caller answers 401 UNAUTHENTICATED.
 */
export async function requireUser(): Promise<SessionUser>;
export async function requireUser(opts: { api: true }): Promise<SessionUser | null>;
export async function requireUser(opts?: { api: true }): Promise<SessionUser | null> {
  const session = await getSession();
  if (session) return session.user;
  if (opts?.api) return null;
  redirect("/login");
}

/** Parse the session token from a raw Cookie header (route handlers that receive a plain Request). */
export function tokenFromCookieHeader(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === SESSION_COOKIE) return decodeURIComponent(v.join("="));
  }
  return null;
}
