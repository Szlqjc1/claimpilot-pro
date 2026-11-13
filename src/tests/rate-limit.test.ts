import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { DEMO_ACCOUNTS, seedDemoUsers } from "@/lib/auth/demo-accounts";
import { RATE_LIMIT_MAX_KEYS, rateLimit, rateLimitKeyCount, resetRateLimitsForTests } from "@/lib/api";
import { POST as login } from "@/app/api/auth/login/route";

// Login throttling across spoofable client identity (DECISIONS D-32).
const suffix = () => randomUUID().slice(0, 8);
const loginReq = (email: string, password: string, ip: string) =>
  login(
    new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
      body: JSON.stringify({ email, password }),
    }),
  );
const spoofedIp = () => `203.0.113.${Math.floor(Math.random() * 250)}-${suffix()}`;

beforeAll(() => seedDemoUsers(prisma));
afterEach(() => vi.useRealTimers());
afterAll(() => prisma.$disconnect());

describe("login throttling", () => {
  it("the account bucket defeats X-Forwarded-For rotation: 10 × 401, then 429", async () => {
    const email = `victim-${suffix()}@joyson.example`;
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await loginReq(email, "Wrong-Password-123", spoofedIp())).status);
    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(401));
    expect(statuses.slice(10)).toEqual([429, 429]);
    const row = await prisma.auditLog.findFirstOrThrow({ where: { action: "Sign-in Throttled", details: `Throttled sign-in attempt for ${email}.` } });
    expect(JSON.parse(row.metadata!)).toMatchObject({ bucket: "account" });
    expect(row.metadata).not.toContain("Wrong-Password-123");
  });

  it("the IP bucket still works: same IP, different emails → 429 from the 6th attempt", async () => {
    const ip = `198.51.100.7-${suffix()}`;
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await loginReq(`user${i}-${suffix()}@joyson.example`, "Wrong-Password-123", ip)).status);
    expect(statuses.slice(0, 5)).toEqual(Array(5).fill(401));
    expect(statuses.slice(5)).toEqual(Array(7).fill(429));
  });

  it("sliding window: the (limit + 1)th call in the window is refused (checked at the 120th)", () => {
    const key = `login:global-test-${suffix()}`;
    const results = Array.from({ length: 120 }, () => rateLimit(key, 100));
    expect(results.slice(0, 100).every(Boolean)).toBe(true);
    expect(results[100]).toBe(false);
    expect(results[119]).toBe(false);
  });

  it("two accounts do not lock each other out: A exhausted, B still signs in", async () => {
    const a = `account-a-${suffix()}@joyson.example`;
    for (let i = 0; i < 10; i++) expect((await loginReq(a, "Wrong-Password-123", spoofedIp())).status).toBe(401);
    expect((await loginReq(a, "Wrong-Password-123", spoofedIp())).status).toBe(429);
    const b = DEMO_ACCOUNTS.find((x) => x.role === "requester")!;
    expect((await loginReq(b.email, b.password, spoofedIp())).status).toBe(200);
  });

  it("bounds the bucket map: expired keys are swept once over the cap; fresh keys still work", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-04T12:00:00Z"));
    const tag = suffix();
    // The sweep runs on the next call, so the map can sit at most one key over the cap.
    for (let i = 0; rateLimitKeyCount() <= RATE_LIMIT_MAX_KEYS; i++) rateLimit(`evict-${tag}-${i}`, 5, 60_000);
    const before = rateLimitKeyCount();
    expect(before).toBeGreaterThan(RATE_LIMIT_MAX_KEYS);
    vi.setSystemTime(new Date("2026-11-04T12:02:00Z")); // every key above is now outside its window
    expect(rateLimit(`fresh-${tag}`, 1)).toBe(true);
    expect(rateLimitKeyCount()).toBeLessThan(before);
    expect(rateLimitKeyCount()).toBeLessThanOrEqual(RATE_LIMIT_MAX_KEYS);
    expect(rateLimit(`fresh-${tag}`, 1)).toBe(false); // the fresh key is tracked normally
  });

  it("bounds the bucket map even when every key is live: oldest keys are dropped", () => {
    const tag = suffix();
    for (let i = 0; i <= RATE_LIMIT_MAX_KEYS + 10; i++) rateLimit(`live-${tag}-${i}`, 5, 60_000);
    expect(rateLimitKeyCount()).toBeLessThanOrEqual(RATE_LIMIT_MAX_KEYS);
  });

  it("global login ceiling is 1000/min: the first 1000 pass, the 1001st is refused", () => {
    const key = `login:global-${suffix()}`;
    const results = Array.from({ length: 1001 }, () => rateLimit(key, 1000));
    expect(results.slice(0, 1000).every(Boolean)).toBe(true);
    expect(results[1000]).toBe(false);
  });

  it("a hot bucket survives eviction: its counter is not reset by a flood of one-shot keys", () => {
    resetRateLimitsForTests(); // the hot key is then the oldest-inserted key, the first to go under FIFO eviction
    const tag = suffix();
    const hot = `hot:${tag}`;
    let i = 0;
    let sawEviction = false;
    // Fill well past the cap so at least one LRU eviction runs, hitting the hot key every 50 insertions.
    while (i < RATE_LIMIT_MAX_KEYS * 1.2) {
      if (i % 50 === 0) rateLimit(hot, 10);
      const before = rateLimitKeyCount();
      rateLimit(`oneshot-${tag}-${i++}`, 5);
      if (rateLimitKeyCount() < before) sawEviction = true;
    }
    expect(sawEviction).toBe(true);
    expect(rateLimit(hot, 10)).toBe(false); // > 10 hits this minute, still counted
    expect(rateLimitKeyCount()).toBeLessThanOrEqual(RATE_LIMIT_MAX_KEYS);
  });

  it("eviction is LRU: insert A then B, hit A again, then evict → B goes before A", () => {
    resetRateLimitsForTests();
    const tag = suffix();
    const A = `lru-a-${tag}`;
    const B = `lru-b-${tag}`;
    rateLimit(A, 1);
    rateLimit(B, 1);
    for (let i = 0; rateLimitKeyCount() < RATE_LIMIT_MAX_KEYS; i++) rateLimit(`filler-${tag}-${i}`, 1);
    expect(rateLimit(A, 1)).toBe(false); // refreshes A's recency; B is now the least recently used
    rateLimit(`overflow-${tag}`, 1); // map is now one over the cap; the next call sweeps
    expect(rateLimit(A, 1)).toBe(false); // A kept its count
    expect(rateLimit(B, 1)).toBe(true); // B was evicted, so it starts over
  });
});
