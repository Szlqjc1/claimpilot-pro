// Lives in src/ (not the repo root): with a src/app layout Next.js only loads src/instrumentation.ts. See DECISIONS D-21.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Skip during build so `next build` does not require runtime secrets.
    if (process.env.NEXT_PHASE !== "phase-production-build") {
      const { validateEnv } = await import("./lib/env");
      validateEnv();
    }
  }
}
