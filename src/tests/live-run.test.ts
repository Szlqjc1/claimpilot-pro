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
const { buildRiskInput } = await import("@/lib/audit/run-audit");
const { evaluateRisk } = await import("@/lib/risk/score");

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
    // Seeded claim: scored on the reference fixture since item 3 (Q1(d)); the model ran as a shadow.
    expect(claim.extractionSource).toBe("fixture");
    expect(run.extractionSource).toBe(claim.extractionSource);
    expect(run.ocrConfidence).toBe(fixture.ocrConfidence);
    const detail = run.runDetail as { modelExtraction: Extraction; modelConfidence: { note: string; fieldConfidence: Record<string, number> }; stageMetrics: { extract: { latencyMs: number; inputTokens: number }; narrative: { inputTokens: number } } };
    expect(detail.modelExtraction.invoiceNumber).toBe(modelExtraction.invoiceNumber);
    expect(detail.modelConfidence).toEqual({ note: "model-reported, uncalibrated", fieldConfidence: modelExtraction.fieldConfidence });
    expect(detail.stageMetrics.extract).toMatchObject({ latencyMs: 5600, inputTokens: 1200 });
    expect(detail.stageMetrics.narrative).toMatchObject({ inputTokens: 11 });
  });
});

describe("item 3: seeded claims score on the reference; the model is a shadow", () => {
  it("a model that misreads the total does not change the score; the diff names the field", async () => {
    const claimId = targets[1];
    const { fixture } = await stubFromFixture(claimId, (e) => ({ ...e, total: e.total + 1000 }));
    // Expected result: the pure engine on the reference extraction, computed before the audit runs.
    const claimRow = await prisma.claim.findUniqueOrThrow({ where: { claimId }, include: { vendor: true, purchaseOrder: true, project: true } });
    const expected = evaluateRisk(await buildRiskInput(claimRow, fixture.extraction));

    const res = await runAudit(claimId, { requestId: "test-live-3" });
    expect(res.claim).toMatchObject({ riskScore: expected.score, riskLevel: expected.riskLevel, decision: expected.decision });
    expect(res.exceptions.map((e) => e.ruleId)).toEqual(expected.findings.map((f) => f.ruleId));
    expect(res.warnings.join(" ")).toMatch(/differs from the reference on 1 field\(s\): total\./);

    const run = await prisma.aiRun.findFirstOrThrow({ where: { claimId }, orderBy: { createdAt: "desc" } });
    const detail = run.runDetail as { extractionDiff: Record<string, { reference: unknown; model: unknown; match: boolean }>; fieldChecks: { scored: Record<string, string>; model: Record<string, string> } };
    expect(detail.extractionDiff.total).toEqual({ reference: fixture.extraction.total, model: fixture.extraction.total + 1000, match: false });
    expect(Object.entries(detail.extractionDiff).filter(([, d]) => !d.match).map(([f]) => f)).toEqual(["total"]);
    expect(detail.fieldChecks.scored.total).toBe("found");
    expect(detail.fieldChecks.model.total).toBe("not_found");
    expect(run).toMatchObject({ mode: "live", extractionSource: "fixture" });
    const stored = await prisma.claim.findUniqueOrThrow({ where: { claimId } });
    expect(JSON.parse(stored.extractedData!).total).toBe(fixture.extraction.total);
  });

  it("a provider failure on a seeded claim is recorded as fallback, scored on the reference", async () => {
    const claimId = targets[2];
    const { ProviderError } = await import("@/lib/ai/deepseek");
    extract = async () => {
      throw new ProviderError("DeepSeek returned 503", "http", 503);
    };
    await runAudit(claimId, { requestId: "test-live-3b" });
    const run = await prisma.aiRun.findFirstOrThrow({ where: { claimId }, orderBy: { createdAt: "desc" } });
    expect(run).toMatchObject({ mode: "fallback", extractionSource: "fallback" });
    expect((await prisma.claim.findUniqueOrThrow({ where: { claimId } })).extractionSource).toBe("fallback");
  });
});

