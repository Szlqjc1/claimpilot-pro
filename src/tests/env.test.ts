import { describe, expect, it } from "vitest";
import { readEnv, startupEnvSchema } from "@/lib/env";

const base = { DATABASE_URL: "file:./dev.db" };

describe("environment validation", () => {
  it("applies defaults", () => {
    expect(readEnv(base)).toMatchObject({ AI_MODE: "mock", OCR_MODE: "fixture", MAX_UPLOAD_MB: 10, DEEPSEEK_MODEL: "deepseek-chat" });
  });
  it("is case-sensitive: AI_MODE=Live is rejected, not treated as mock", () => {
    expect(() => readEnv({ ...base, AI_MODE: "Live" })).toThrow(/AI_MODE/);
  });
  it("requires DATABASE_URL", () => {
    expect(() => readEnv({})).toThrow(/DATABASE_URL/);
  });
  it("rejects a non-numeric MAX_UPLOAD_MB", () => {
    expect(() => readEnv({ ...base, MAX_UPLOAD_MB: "ten" })).toThrow(/MAX_UPLOAD_MB/);
  });
  it("startup rule: live mode requires a key", () => {
    const res = startupEnvSchema.safeParse({ ...base, AI_MODE: "live", DEEPSEEK_API_KEY: "  " });
    expect(res.success).toBe(false);
    expect(res.error?.issues[0].message).toBe("AI_MODE=live requires DEEPSEEK_API_KEY");
    expect(startupEnvSchema.safeParse({ ...base, AI_MODE: "live", DEEPSEEK_API_KEY: "sk-test" }).success).toBe(true);
  });
});
