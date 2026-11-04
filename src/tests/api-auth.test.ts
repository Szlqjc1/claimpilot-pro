import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Regression guard: every API route must check the session, except the explicit allowlist.
const API_DIR = path.resolve(__dirname, "../app/api");
const ALLOWLIST = new Set(["/api/auth/login", "/api/auth/logout"]);

function routeFiles(): { route: string; file: string }[] {
  return (readdirSync(API_DIR, { recursive: true }) as string[])
    .map((rel) => rel.split(path.sep).join("/"))
    .filter((rel) => rel.endsWith("/route.ts") || rel === "route.ts")
    .map((rel) => ({ route: `/api/${rel.replace(/\/?route\.ts$/, "")}`, file: path.join(API_DIR, rel) }));
}

describe("API authentication guard", () => {
  it("every route.ts under src/app/api calls requireUser (except login/logout)", () => {
    const files = routeFiles();
    expect(files.length).toBeGreaterThanOrEqual(9);
    const missing = files.filter(({ route, file }) => !ALLOWLIST.has(route) && !readFileSync(file, "utf8").includes("requireUser")).map((f) => f.route);
    expect(missing, `API routes without requireUser: ${missing.join(", ")}`).toEqual([]);
    for (const allowed of ALLOWLIST) expect(files.map((f) => f.route), `allowlisted route ${allowed} no longer exists`).toContain(allowed);
  });
});
