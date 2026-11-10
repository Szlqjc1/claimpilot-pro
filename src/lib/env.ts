import { z } from "zod";

// Environment contract. No "server-only" import: instrumentation may load this in more than one runtime.

const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

/** Shape + types of every variable. Case-sensitive: AI_MODE=Live is an error, not mock mode. */
export const envSchema = z.object({
  DATABASE_URL: z.string({ required_error: "DATABASE_URL is required" }).min(1, "DATABASE_URL is required"),
  AI_MODE: z.preprocess(emptyToUndefined, z.enum(["mock", "live"]).default("mock")),
  OCR_MODE: z.preprocess(emptyToUndefined, z.enum(["fixture", "tesseract"]).default("fixture")),
  /** D-50: detect the page in an uploaded photo and warp it flat before OCR. "off" reads every upload as uploaded. */
  OCR_RECTIFY: z.preprocess(emptyToUndefined, z.enum(["on", "off"]).default("on")),
  MAX_UPLOAD_MB: z.preprocess(emptyToUndefined, z.coerce.number().int().positive().default(10)),
  DEEPSEEK_API_KEY: z.preprocess((v) => (typeof v === "string" ? v.trim() || undefined : v), z.string().optional()),
  DEEPSEEK_BASE_URL: z.preprocess(emptyToUndefined, z.string().url().default("https://api.deepseek.com")),
  DEEPSEEK_MODEL: z.preprocess(emptyToUndefined, z.string().min(1).default("deepseek-chat")),
  SESSION_TTL_HOURS: z.preprocess(emptyToUndefined, z.coerce.number().int().positive().max(720).default(24)),
});

/** Startup contract: the shape above plus cross-field rules. */
export const startupEnvSchema = envSchema.superRefine((env, ctx) => {
  if (env.AI_MODE === "live" && !env.DEEPSEEK_API_KEY) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["DEEPSEEK_API_KEY"], message: "AI_MODE=live requires DEEPSEEK_API_KEY" });
  }
});

export type Env = z.infer<typeof envSchema>;

function describe(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join(".") || "env"}: ${i.message}`).join("; ");
}

/**
 * Typed read of the current environment (shape only). Throws a clear error on a bad value.
 * Cross-field rules are enforced once at startup by validateEnv(); runtime callers keep
 * their own graceful handling (e.g. 503 when live mode has no key).
 */
export function readEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) throw new Error(`Invalid environment configuration — ${describe(parsed.error)}`);
  return parsed.data;
}

/** Fail fast at server start: log one clear line and exit. */
export function validateEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = startupEnvSchema.safeParse(source);
  if (!parsed.success) {
    console.error(`[env] Invalid configuration — ${describe(parsed.error)}. Fix .env (see .env.example) and restart.`);
    process.exit(1);
  }
  return parsed.data;
}
