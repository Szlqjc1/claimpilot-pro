import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import type { Extraction } from "@/lib/domain/schemas";

// Live-mode provenance and auditability (DECISIONS D-37). The DeepSeek client is stubbed: no network.
// Uses pending historical claims that no other test file touches (not heroes, not Priya's).

type Live = { extraction: Extraction; usage: { inputTokens: number; outputTokens: number }; latencyMs: number; model: string; repaired: boolean };
let extract: (ocrText: string) => Promise<Live>;
vi.mock("@/lib/ai/deepseek", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/deepseek")>()),
  extractWithDeepSeek: (ocrText: string) => extract(ocrText),
  narrativeWithDeepSeek: async () => ({ narrative: "Stub narrative.", usage: { inputTokens: 11, outputTokens: 7 } }),
}));

const { runAudit } = await import("@/lib/audit/run-audit");
const { loadFixture } = await import("@/lib/ai/ocr");

let targets: string[] = [];
beforeAll(async () => {
  const rows = await prisma.claim.findMany({
    where: { status: "Pending", source: "seed", employee: { not: "Priya Natarajan" }, NOT: { claimId: { startsWith: "CLM-2026-014" } } },
    orderBy: { claimId: "desc" },
    take: 3,
  });
  targets = rows.map((r) => r.claimId);
  expect(targets).toHaveLength(3);
  process.env.AI_MODE = "live";
  process.env.DEEPSEEK_API_KEY = "test-key";
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  process.env.AI_MODE = "mock";
  delete process.env.DEEPSEEK_API_KEY;
  await prisma.$disconnect();
});

async function stubFromFixture(claimId: string, edit: (e: Extraction) => Extraction = (e) => e) {
  const fixture = (await loadFixture(claimId))!;
  const modelExtraction = edit({ ...fixture.extraction, fieldConfidence: Object.fromEntries(Object.keys(fixture.extraction.fieldConfidence).map((k) => [k, 0.9])) });
  extract = async () => ({ extraction: modelExtraction, usage: { inputTokens: 1200, outputTokens: 300 }, latencyMs: 5600, model: "deepseek-chat", repaired: false });
  return { fixture, modelExtraction };
}

describe("item 1: provenance and run detail are persisted", () => {
  it("a live run records extractionSource on claim and run, the OCR-layer mean, and the model's raw extraction", async () => {
    const claimId = targets[0];
    const { fixture, modelExtraction } = await stubFromFixture(claimId);
    await runAudit(claimId, { requestId: "test-live-1" });
    const claim = await prisma.claim.findUniqueOrThrow({ where: { claimId } });
    const run = await prisma.aiRun.findFirstOrThrow({ where: { claimId }, orderBy: { createdAt: "desc" } });
    expect(claim.extractionSource).toBe("model");
    expect(run.extractionSource).toBe(claim.extractionSource);
    expect(run.ocrConfidence).toBe(fixture.ocrConfidence);
    const detail = run.runDetail as { modelExtraction: Extraction; modelConfidence: { note: string; fieldConfidence: Record<string, number> }; stageMetrics: { extract: { latencyMs: number; inputTokens: number }; narrative: { inputTokens: number } } };
    expect(detail.modelExtraction.invoiceNumber).toBe(modelExtraction.invoiceNumber);
    expect(detail.modelConfidence).toEqual({ note: "model-reported, uncalibrated", fieldConfidence: modelExtraction.fieldConfidence });
    expect(detail.stageMetrics.extract).toMatchObject({ latencyMs: 5600, inputTokens: 1200 });
    expect(detail.stageMetrics.narrative).toMatchObject({ inputTokens: 11 });
  });
});
