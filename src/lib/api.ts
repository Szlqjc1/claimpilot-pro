import "server-only";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

export function newRequestId(): string {
  return randomUUID().slice(0, 13);
}

/** Uniform error body: { error: { code, message, requestId } } — never a stack trace. */
export function jsonError(status: number, code: string, message: string, requestId: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error: { code, message, requestId, ...extra } }, { status, headers: { "x-request-id": requestId } });
}

/** Reject cross-origin browser requests to mutating endpoints. */
export function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // non-browser clients and same-origin navigations
  try {
    return new URL(origin).host === req.headers.get("host");
  } catch {
    return false;
  }
}

/**
 * True when the request reached us over HTTPS. The first `x-forwarded-proto` hop wins (reverse proxies
 * terminate TLS); otherwise the request URL's protocol. Drives the cookie `Secure` flag (DECISIONS D-30).
 */
export function isSecureRequest(req: Request): boolean {
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? new URL(req.url).protocol.replace(":", "");
  return proto === "https";
}

/** Best-effort client IP for rate limiting and audit metadata. */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (fwd || req.headers.get("x-real-ip") || "unknown").slice(0, 64);
}

type Bucket = { hits: number[]; windowMs: number };
const buckets = new Map<string, Bucket>();

/** Above this many keys, rateLimit() sweeps expired buckets (DECISIONS D-32). */
export const RATE_LIMIT_MAX_KEYS = 5_000;

/**
 * Bound the bucket map. Keys can now contain attacker-chosen text (the submitted email), so an
 * unbounded map is a memory-exhaustion vector.
 *
 * Trade-off: one O(n) pass, only while the map is over the cap. Pass 1 drops buckets whose hits are
 * all outside their window (they carry no information). If live buckets alone still exceed the cap,
 * pass 2 drops least-recently-used keys down to 90% of the cap, so a sustained flood pays the sweep
 * once per ~500 new keys instead of on every request. rateLimit() re-inserts a key on every hit, so
 * Map iteration order is recency order and eviction is LRU: a bucket that is actively being hit (e.g.
 * an account under attack) stays at the back and survives. Dropping a live bucket still forgets its
 * count, so an attacker who floods distinct keys *slows* the throttle (they must out-pace the hot key)
 * rather than being able to preserve or reset a specific bucket deliberately (DECISIONS D-33).
 */
function evictBuckets(now: number): void {
  if (buckets.size <= RATE_LIMIT_MAX_KEYS) return;
  for (const [key, b] of buckets) {
    if (b.hits.every((t) => now - t >= b.windowMs)) buckets.delete(key);
  }
  if (buckets.size <= RATE_LIMIT_MAX_KEYS) return;
  const target = Math.floor(RATE_LIMIT_MAX_KEYS * 0.9);
  for (const key of buckets.keys()) {
    if (buckets.size <= target) break;
    buckets.delete(key);
  }
}

/** Simple in-memory sliding window: `limit` requests per `windowMs` per key. Single process only. */
export function rateLimit(key: string, limit = 5, windowMs = 60_000): boolean {
  const now = Date.now();
  evictBuckets(now);
  const hits = (buckets.get(key)?.hits ?? []).filter((t) => now - t < windowMs);
  // delete + set moves the key to the back of the Map: iteration order is recency order (LRU eviction).
  buckets.delete(key);
  if (hits.length >= limit) {
    buckets.set(key, { hits, windowMs });
    return false;
  }
  hits.push(now);
  buckets.set(key, { hits, windowMs });
  return true;
}

/** Test hook: forget every bucket, so a test can reason about eviction order from an empty map. */
export function resetRateLimitsForTests(): void {
  buckets.clear();
}

/** Test hook: current number of rate-limit keys held in memory. */
export function rateLimitKeyCount(): number {
  return buckets.size;
}
