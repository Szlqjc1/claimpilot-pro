import "server-only";
import { readEnv } from "@/lib/env";

// Server-only AI configuration. Nothing here is ever sent to the browser except aiStatus().

export type AiConfig = {
  mode: "mock" | "live";
  apiKey: string | null;
  baseUrl: string;
  model: string;
  ocrMode: "fixture" | "tesseract";
  /** D-50: page rectification for Tesseract uploads (OCR_RECTIFY). */
  ocrRectify: boolean;
  maxUploadBytes: number;
};

/** Reads the validated environment (src/lib/env.ts); an invalid value throws instead of silently falling back. */
export function aiConfig(): AiConfig {
  const env = readEnv();
  return {
    mode: env.AI_MODE,
    apiKey: env.DEEPSEEK_API_KEY ?? null,
    baseUrl: env.DEEPSEEK_BASE_URL.replace(/\/+$/, ""),
    model: env.DEEPSEEK_MODEL,
    ocrMode: env.OCR_MODE,
    ocrRectify: env.OCR_RECTIFY === "on",
    maxUploadBytes: env.MAX_UPLOAD_MB * 1024 * 1024,
  };
}

/** Safe, serializable summary for the UI. Never includes the key. */
export function aiStatus() {
  const c = aiConfig();
  return {
    mode: c.mode,
    configured: c.mode === "mock" || c.apiKey !== null,
    label: c.mode === "mock" ? "Demo AI" : c.apiKey ? "DeepSeek live" : "AI not configured",
    model: c.mode === "live" ? c.model : "fixture",
    ocrMode: c.ocrMode,
  };
}

export type AiStatus = ReturnType<typeof aiStatus>;
