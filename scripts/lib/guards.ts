// Preconditions for scripts that drive the running app (pnpm shots, pnpm a11y:audit). A comment saying "requires
// mock mode" did not stop a live run that made three real DeepSeek audits (Task 11); these checks do.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export type ModeCheck = { ok: boolean; mode: string; source: string; message?: string };

/** Read AI_MODE from a .env file's text (KEY=value or KEY="value"); null when absent. */
export function aiModeFromEnvFile(text: string | null): string | null {
  if (!text) return null;
  const m = /^\s*AI_MODE\s*=\s*["']?([^"'\r\n#]*)["']?/m.exec(text);
  return m ? m[1].trim() : null;
}

/**
 * Pure decision. The process environment wins over the .env file (as it does for the Next server); an empty or
 * missing value defaults to mock. Anything other than mock is refused unless argv contains --allow-live.
 */
export function checkMockMode(input: { argv: string[]; env: Record<string, string | undefined>; envFileText: string | null; envFileName?: string }): ModeCheck {
  const fromEnv = input.env.AI_MODE?.trim();
  const fromFile = aiModeFromEnvFile(input.envFileText);
  const mode = (fromEnv || fromFile || "mock").toLowerCase();
  const source = fromEnv ? "the environment" : fromFile ? (input.envFileName ?? ".env") : "the default";
  if (mode === "mock" || input.argv.includes("--allow-live")) return { ok: true, mode, source };
  return {
    ok: false,
    mode,
    source,
    message: `AI_MODE=${mode} found in ${source} — screenshots must be captured in mock mode. Run with --allow-live to override.`,
  };
}

/** Exit 1 unless the app is in mock mode (or the caller passed --allow-live). */
export function requireMockMode(argv: string[] = process.argv.slice(2)): void {
  const envFile = path.resolve(".env");
  const result = checkMockMode({ argv, env: process.env, envFileText: existsSync(envFile) ? readFileSync(envFile, "utf8") : null, envFileName: ".env" });
  if (!result.ok) {
    console.error(result.message);
    process.exit(1);
  }
  if (result.mode !== "mock") console.warn(`Running with AI_MODE=${result.mode} (--allow-live): audits will call the live model.`);
}

/** Exit 1 with the exact command to start the server when `baseUrl` does not answer. */
export async function requireServer(baseUrl: string, rerun: string): Promise<void> {
  try {
    const res = await fetch(`${baseUrl}/login`, { signal: AbortSignal.timeout(5_000) });
    if (res.ok) return;
    console.error(`Server at ${baseUrl} answered ${res.status} for /login. Restart it with \`pnpm dev\`, then re-run \`${rerun}\`.`);
  } catch {
    console.error(`No server at ${baseUrl}. Start it in another terminal with \`pnpm dev\`, then re-run \`${rerun}\`.`);
  }
  process.exit(1);
}

/**
 * Pure check of the mode the RUNNING SERVER reports (its topbar badge title, "AI mode: Demo AI · OCR: fixture").
 * The script's own AI_MODE is not enough: the dev server reads .env at start-up, so `AI_MODE=mock pnpm shots`
 * against a server started in live mode would still call the live model.
 */
export function checkServerMode(badgeTitle: string | null, argv: string[]): { ok: boolean; message?: string } {
  if (argv.includes("--allow-live")) return { ok: true };
  if (badgeTitle?.includes("Demo AI")) return { ok: true };
  const reported = badgeTitle?.replace(/^AI mode:\s*/, "") ?? "unknown (no AI mode badge on the page)";
  return {
    ok: false,
    message: `The running server reports AI mode ${reported} — it reads AI_MODE from .env at start-up. Restart \`pnpm dev\` with AI_MODE="mock", or run with --allow-live to override.`,
  };
}

/** Exit 1 unless the running server is in mock mode. `readBadgeTitle` reads the topbar badge's title. */
export async function requireServerMock(readBadgeTitle: () => Promise<string | null>, argv: string[] = process.argv.slice(2)): Promise<void> {
  const result = checkServerMode(await readBadgeTitle(), argv);
  if (!result.ok) {
    console.error(result.message);
    process.exit(1);
  }
}
