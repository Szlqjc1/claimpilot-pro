import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { createSession, getSessionByToken, tokenFromCookieHeader } from "@/lib/auth/session";
import { DEMO_ACCOUNTS, seedDemoUsers } from "@/lib/auth/demo-accounts";
import { safeNextPath } from "@/lib/auth/constants";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { GET as kpis } from "@/app/api/kpis/route";

// No request cookie store in Vitest: report "no cookie" so API routes see an anonymous caller.
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

const reviewer = DEMO_ACCOUNTS.find((a) => a.role === "reviewer")!;
const loginReq = (email: string, password: string) =>
  login(new Request("http://localhost/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) }));

beforeAll(async () => {
  await seedDemoUsers(prisma);
});
afterAll(() => prisma.$disconnect());

describe("password hashing", () => {
  it("round-trips and uses salt:hash format", () => {
    const stored = hashPassword("Correct-Horse-Battery-26");
    expect(stored).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/);
    expect(verifyPassword("Correct-Horse-Battery-26", stored)).toBe(true);
    expect(hashPassword("Correct-Horse-Battery-26")).not.toBe(stored); // random salt
  });
  it("rejects a wrong password and malformed hashes", () => {
    const stored = hashPassword("Correct-Horse-Battery-26");
    expect(verifyPassword("correct-horse-battery-26", stored)).toBe(false);
    expect(verifyPassword("anything", "not-a-hash")).toBe(false);
  });
});

describe("sessions", () => {
  it("returns the user for a live session", async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email: reviewer.email } });
    const { token } = await createSession(user.id);
    expect((await getSessionByToken(token))?.user).toMatchObject({ email: reviewer.email, role: "reviewer" });
  });
  it("expired session returns null and deletes the row", async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email: reviewer.email } });
    const { token } = await createSession(user.id, new Date(Date.now() - 25 * 3_600_000));
    expect(await getSessionByToken(token)).toBeNull();
    expect(await prisma.session.findUnique({ where: { token } })).toBeNull();
  });
  it("parses the cookie header and rejects unsafe redirect targets", () => {
    expect(tokenFromCookieHeader("a=1; cp_session=abc_DEF-123; b=2")).toBe("abc_DEF-123");
    expect(safeNextPath("//evil.example")).toBe("/dashboard");
    expect(safeNextPath("https://evil.example")).toBe("/dashboard");
    expect(safeNextPath("/claims/CLM-2026-0142")).toBe("/claims/CLM-2026-0142");
  });
});

describe("login and logout routes", () => {
  it("unknown email and wrong password get the identical 401", async () => {
    const wrong = await loginReq(reviewer.email, "Wrong-Password-123");
    const unknown = await loginReq("nobody@joyson.example", "Wrong-Password-123");
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    const [a, b] = (await Promise.all([wrong.json(), unknown.json()])) as { error: { code: string; message: string } }[];
    expect(a.error.code).toBe("INVALID_CREDENTIALS");
    expect(a.error.message).toBe(b.error.message);
    expect(wrong.headers.get("set-cookie")).toBeNull();
    expect(await prisma.auditLog.count({ where: { action: "Sign-in Failed" } })).toBeGreaterThanOrEqual(2);
  });

  it("login sets an HttpOnly session cookie; logout deletes the session row", async () => {
    const res = await loginReq(reviewer.email.toUpperCase(), reviewer.password);
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toMatch(/cp_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toMatch(/Max-Age=86400/);
    const token = tokenFromCookieHeader(cookie.split(";")[0])!;
    expect(await prisma.session.findUnique({ where: { token } })).not.toBeNull();
    const signedIn = await prisma.auditLog.findFirst({ where: { action: "User Signed In" }, orderBy: { timestamp: "desc" } });
    expect(signedIn?.actor).toBe(reviewer.name);
    expect(JSON.parse(signedIn!.metadata!)).toHaveProperty("ip");

    const out = await logout(new Request("http://localhost/api/auth/logout", { method: "POST", headers: { cookie: `cp_session=${token}` } }));
    expect(out.status).toBe(200);
    expect(out.headers.get("set-cookie")).toMatch(/Max-Age=0/);
    expect(await prisma.session.findUnique({ where: { token } })).toBeNull();
    expect(await prisma.auditLog.count({ where: { action: "User Signed Out", actor: reviewer.name } })).toBe(1);
  });

  it("API routes answer 401 UNAUTHENTICATED without a session", async () => {
    const res = await kpis(new Request("http://localhost/api/kpis"));
    expect(res.status).toBe(401);
    expect(res.headers.get("x-request-id")).toBeTruthy();
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("UNAUTHENTICATED");
  });
});
