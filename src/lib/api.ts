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

const buckets = new Map<string, number[]>();

/** Simple in-memory sliding window: `limit` requests per `windowMs` per key. */
export function rateLimit(key: string, limit = 5, windowMs = 60_000): boolean {
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    buckets.set(key, hits);
    return false;
  }
  hits.push(now);
  buckets.set(key, hits);
  return true;
}
