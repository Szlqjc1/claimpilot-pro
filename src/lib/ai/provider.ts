import "server-only";

// Server-only AI configuration. Nothing here is ever sent to the browser except aiStatus().

export type AiConfig = {
  mode: "mock" | "live";
  apiKey: string | null;
  baseUrl: string;
  model: string;
  ocrMode: "fixture" | "tesseract";
  maxUploadBytes: number;
};

export function aiConfig(): AiConfig {
  const key = process.env.DEEPSEEK_API_KEY?.trim();
  return {
    mode: process.env.AI_MODE === "live" ? "live" : "mock",
    apiKey: key ? key : null,
    baseUrl: (process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com").replace(/\/+$/, ""),
    model: process.env.DEEPSEEK_MODEL ?? "deepseek-chat",
    ocrMode: process.env.OCR_MODE === "tesseract" ? "tesseract" : "fixture",
    maxUploadBytes: Math.max(1, Number(process.env.MAX_UPLOAD_MB ?? 10)) * 1024 * 1024,
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
