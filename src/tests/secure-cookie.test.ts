import { describe, expect, it } from "vitest";
import { isSecureRequest } from "@/lib/api";

const req = (url: string, proto?: string) => new Request(url, { headers: proto ? { "x-forwarded-proto": proto } : {} });

describe("isSecureRequest (cookie Secure flag follows the protocol, not NODE_ENV)", () => {
  it("plain http → false", () => expect(isSecureRequest(req("http://localhost:3000/api/auth/login"))).toBe(false));
  it("https → true", () => expect(isSecureRequest(req("https://claims.ironwood.example/api/auth/login"))).toBe(true));
  it("x-forwarded-proto: https behind a TLS-terminating proxy → true", () => expect(isSecureRequest(req("http://10.0.0.5:3000/api/auth/login", "https"))).toBe(true));
  it("x-forwarded-proto: http wins over an https URL → false", () => expect(isSecureRequest(req("https://claims.ironwood.example/api/auth/login", "http"))).toBe(false));
  it("uses the first hop of a comma-separated chain", () => expect(isSecureRequest(req("http://localhost/api/auth/login", "https, http"))).toBe(true));
});
