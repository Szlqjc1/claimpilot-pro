import { describe, expect, it } from "vitest";
import { aiModeFromEnvFile, checkMockMode, checkServerMode } from "../../scripts/lib/guards";

// Script preconditions (Task 11): screenshots and the a11y audit must not run against the live model by accident.

describe("checkMockMode", () => {
  const run = (env: Record<string, string | undefined>, envFileText: string | null, argv: string[] = []) => checkMockMode({ argv, env, envFileText, envFileName: ".env" });

  it("mock passes", () => {
    expect(run({}, 'AI_MODE="mock"\n')).toMatchObject({ ok: true, mode: "mock", source: ".env" });
    expect(run({ AI_MODE: "mock" }, null)).toMatchObject({ ok: true, source: "the environment" });
  });

  it("live in .env is refused, and the message names the file and the override", () => {
    const r = run({}, 'DEEPSEEK_API_KEY="sk-x"\nAI_MODE="live"\nOCR_MODE="tesseract"\n');
    expect(r.ok).toBe(false);
    expect(r.message).toBe("AI_MODE=live found in .env — screenshots must be captured in mock mode. Run with --allow-live to override.");
  });

  it("live in the environment is refused and wins over a mock .env", () => {
    const r = run({ AI_MODE: "live" }, 'AI_MODE="mock"\n');
    expect(r).toMatchObject({ ok: false, mode: "live", source: "the environment" });
    expect(r.message).toContain("found in the environment");
  });

  it("--allow-live passes", () => {
    expect(run({}, 'AI_MODE="live"\n', ["--allow-live"])).toMatchObject({ ok: true, mode: "live" });
  });

  it("empty or missing AI_MODE defaults to mock", () => {
    expect(run({}, null)).toMatchObject({ ok: true, mode: "mock", source: "the default" });
    expect(run({ AI_MODE: "" }, "OCR_MODE=fixture\n")).toMatchObject({ ok: true, mode: "mock" });
    expect(run({}, 'AI_MODE=""\n')).toMatchObject({ ok: true, mode: "mock" });
  });
});

describe("aiModeFromEnvFile", () => {
  it.each([
    ['AI_MODE="live"', "live"],
    ["AI_MODE=mock", "mock"],
    ["  AI_MODE = 'live'  # comment", "live"],
    ["# AI_MODE=live\nAI_MODE=mock", "mock"],
    ["OCR_MODE=fixture", null],
  ] as const)("%j → %j", (text, expected) => {
    expect(aiModeFromEnvFile(text)).toBe(expected);
  });
});

describe("checkServerMode (what the running server reports)", () => {
  it("Demo AI passes; live or a missing badge is refused unless --allow-live", () => {
    expect(checkServerMode("AI mode: Demo AI · OCR: fixture", [])).toEqual({ ok: true });
    const live = checkServerMode("AI mode: DeepSeek live · OCR: tesseract", []);
    expect(live.ok).toBe(false);
    expect(live.message).toContain("DeepSeek live · OCR: tesseract");
    expect(checkServerMode(null, []).ok).toBe(false);
    expect(checkServerMode("AI mode: DeepSeek live · OCR: tesseract", ["--allow-live"])).toEqual({ ok: true });
  });
});

