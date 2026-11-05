import "server-only";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { PROMPT_VERSION_EXTRACT, PROMPT_VERSION_NARRATIVE, type Category } from "@/lib/domain/constants";
import { toCents } from "@/lib/domain/money";
import { addDays } from "@/lib/domain/dates";
import type { Extraction } from "@/lib/domain/schemas";
import { aiConfig } from "@/lib/ai/provider";
import { ProviderError, extractWithDeepSeek, narrativeWithDeepSeek } from "@/lib/ai/deepseek";
import { loadFixture, ocrFromFixture, ocrWithTesseract, type OcrResult } from "@/lib/ai/ocr";
import { annotateReceipt } from "@/lib/ai/annotate";
import { templateNarrative } from "@/lib/ai/narrative";
import { readReceiptFile, writeReceiptFile } from "@/lib/receipts/storage";
import { sha256 } from "@/lib/receipts/invoice";
import { evaluateRisk } from "@/lib/risk/score";
import { normalizeVendorName } from "@/lib/risk/rules";
import type { RiskInput } from "@/lib/risk/types";
import { resolveAssignment } from "@/lib/domain/routing";
import { groundExtraction } from "@/lib/ai/grounding";
import { diffExtractions, type ExtractionDiff } from "./extraction-diff";
import { auditEntryFor } from "./wording";

export class AuditError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "AuditError";
  }
}

export type AuditResponse = {
  claim: { claimId: string; status: string; riskScore: number; riskLevel: string; decision: string; analyzedAt: string; assignedRole: string | null; assignedTo: string | null; assignmentExcluded: boolean };
  exceptions: { exceptionId: string; ruleId: string; anomalyType: string; riskLevel: string; points: number; message: string }[];
  auditLog: { actor: string; action: string; details: string };
  aiRun: { mode: string; provider: string; model: string; latencyMs: number; promptVersion: string };
  narrative: string;
  warnings: string[];
};

const ALLOWED_MIME = new Set(["image/svg+xml", "image/png", "image/jpeg", "application/pdf"]);
const inFlight = new Set<string>();

export type RunAuditOptions = {
  requestId: string;
  idempotencyKey?: string | null;
  /** Human who triggered the audit; recorded in metadata, never as `actor` (that stays "AI-RPA Agent"). */
  initiatedBy?: string;
  revalidate?: (paths: string[]) => void;
};

export async function runAudit(claimId: string, opts: RunAuditOptions): Promise<AuditResponse> {
  // Idempotent replay: same Idempotency-Key returns the original result.
  if (opts.idempotencyKey) {
    const prior = await prisma.aiRun.findUnique({ where: { requestKey: opts.idempotencyKey } });
    if (prior?.responseJson) {
      if (prior.claimId !== claimId) throw new AuditError(422, "IDEMPOTENCY_KEY_REUSED", "Idempotency-Key was already used for a different claim");
      return JSON.parse(prior.responseJson) as AuditResponse;
    }
  }

  // 1–2. Load claim; only Pending claims can be audited, and nothing is written otherwise.
  const claim = await prisma.claim.findUnique({ where: { claimId }, include: { vendor: true, purchaseOrder: true, project: true } });
  if (!claim) throw new AuditError(404, "CLAIM_NOT_FOUND", `Claim ${claimId} not found`);
  if (claim.status !== "Pending") throw new AuditError(409, "CLAIM_NOT_PENDING", `Claim is already ${claim.status}`, { currentStatus: claim.status });

  // 3. In-process guard; the DB status guard + unique AiRun key back it up across processes.
  if (inFlight.has(claimId)) throw new AuditError(409, "AUDIT_IN_PROGRESS", "An audit for this claim is already running", { currentStatus: claim.status });
  inFlight.add(claimId);
  const started = Date.now();
  try {
    const cfg = aiConfig();

    // 4. Receipt checks.
    const fileName = claim.receiptName ?? "original.svg";
    const receipt = await readReceiptFile(claimId, fileName);
    const mime = claim.receiptMime ?? "image/svg+xml";
    if (!receipt) {
      await prisma.auditLog.create({
        data: { logId: randomUUID(), actor: "System", action: "Audit Failed", details: "Original receipt file is missing; claim left Pending.", claimId, metadata: JSON.stringify({ requestId: opts.requestId }) },
      });
      throw new AuditError(422, "RECEIPT_MISSING", "Original receipt file is missing");
    }
    if (!ALLOWED_MIME.has(mime)) throw new AuditError(422, "RECEIPT_UNSUPPORTED", `Unsupported receipt type ${mime}`);
    if (receipt.length > cfg.maxUploadBytes) throw new AuditError(422, "RECEIPT_TOO_LARGE", "Receipt exceeds the upload size limit");
    const receiptHash = sha256(receipt);
    const guardKey = `${claimId}:${receiptHash}:${PROMPT_VERSION_EXTRACT}`;

    // 5–6. OCR + extraction.
    const fixture = claim.source === "seed" ? await loadFixture(claimId) : null;
    const warnings: string[] = [];
    let extraction: Extraction;
    let ocr: OcrResult;
    let run = { mode: "mock", provider: "fixture", model: "fixture-ocr + deterministic-rules", inputTokens: 0, outputTokens: 0 };
    // Per-run detail persisted in AiRun.runDetail (D-37). Nothing here feeds the score.
    const stage: { extract: { latencyMs: number; inputTokens: number; outputTokens: number; repaired: boolean } | null; narrative: { latencyMs: number; inputTokens: number; outputTokens: number } | null } = {
      extract: null,
      narrative: null,
    };
    let modelExtraction: Extraction | null = null;
    let extractionDiff: ExtractionDiff | null = null;

    if (cfg.mode === "mock") {
      if (!fixture) throw new AuditError(422, "OCR_DISABLED", "Live OCR is disabled in demo mode. Seeded claims use deterministic fixtures.");
      ocr = ocrFromFixture(fixture);
      extraction = fixture.extraction;
    } else {
      if (!cfg.apiKey) throw new AuditError(503, "AI_NOT_CONFIGURED", "AI provider is not configured");
      if (fixture) ocr = ocrFromFixture(fixture);
      else if (cfg.ocrMode === "tesseract" && (mime === "image/png" || mime === "image/jpeg")) ocr = await ocrWithTesseract(receipt);
      else throw new AuditError(422, "OCR_UNAVAILABLE", "No OCR source for this receipt. Enable OCR_MODE=tesseract for PNG/JPEG uploads.");
      try {
        const live = await extractWithDeepSeek(ocr.text, { category: claim.category }, opts.requestId);
        modelExtraction = live.extraction;
        stage.extract = { latencyMs: live.latencyMs, ...live.usage, repaired: live.repaired };
        run = { mode: "live", provider: "deepseek", model: live.model, inputTokens: live.usage.inputTokens, outputTokens: live.usage.outputTokens };
        if (live.repaired) warnings.push("Extraction JSON needed one repair pass.");
        if (fixture) {
          // Seeded claim (D-37, Q1(d)): the fixture is the known answer and is what gets scored; the model runs as
          // a shadow, and any field-level disagreement is recorded and surfaced, never scored.
          extraction = fixture.extraction;
          extractionDiff = diffExtractions(fixture.extraction, live.extraction);
          const differing = Object.entries(extractionDiff).filter(([, d]) => !d.match).map(([f]) => f);
          if (differing.length) warnings.push(`Model extraction differs from the reference on ${differing.length} field(s): ${differing.join(", ")}. Scored on the reference extraction.`);
        } else {
          // Upload: no known answer, so the model's extraction is scored. Geometry and confidence come from the OCR
          // layer, never the LLM (D-37): the model's self-reported numbers are kept in runDetail.modelConfidence only.
          const ocrConf = Object.fromEntries(Object.keys(live.extraction.fieldConfidence).map((k) => [k, ocr.confidence]));
          extraction = { ...live.extraction, boundingBoxes: ocr.boxes, fieldConfidence: ocrConf, vendor: { ...live.extraction.vendor, confidence: ocr.confidence } };
        }
      } catch (err) {
        if (!(err instanceof ProviderError)) throw err;
        if (!fixture) throw new AuditError(502, "AI_PROVIDER_FAILED", `AI extraction failed: ${err.message}. Claim left Pending; retry later.`);
        extraction = fixture.extraction;
        run = { mode: "fallback", provider: "fixture", model: "fixture-ocr (fallback)", inputTokens: 0, outputTokens: 0 };
        warnings.push(`DeepSeek unavailable (${err.message}); deterministic fixture used instead.`);
      }
    }
    warnings.push(...extraction.warnings);
    // D-37: deterministic grounding is part of the extraction stage, attached before scoring (R-14 reads it).
    extraction = { ...extraction, fieldChecks: groundExtraction(extraction, ocr.text) };

    // 7. Deterministic risk — the LLM never touches the score.
    const riskInput = await buildRiskInput(claim, extraction);
    const result = evaluateRisk(riskInput);
    // Escalation routing (D-34): only flagged claims are assigned; never to the submitter.
    const assignment =
      result.findings.length > 0
        ? resolveAssignment(claim.department, result.findings.length, await prisma.employee.findMany({ select: { name: true, title: true } }), claim.employee)
        : null;

    // 8. Narrative explains findings only.
    const amountCents = toCents(claim.amount);
    let narrative = templateNarrative(result, { claimId, vendorName: claim.vendorName, amountCents });
    if (run.mode === "live") {
      try {
        const narrativeStarted = Date.now();
        const n = await narrativeWithDeepSeek(
          JSON.stringify({ score: result.score, riskLevel: result.riskLevel, decision: result.decision, findings: result.findings.map((f) => ({ ruleId: f.ruleId, anomalyType: f.anomalyType, points: f.points, message: f.message })) }),
          opts.requestId,
        );
        narrative = n.narrative;
        stage.narrative = { latencyMs: Date.now() - narrativeStarted, ...n.usage };
        run.inputTokens += n.usage.inputTokens;
        run.outputTokens += n.usage.outputTokens;
      } catch {
        warnings.push("Narrative generated from template (LLM narrative unavailable).");
      }
    }

    // 9. Annotated SVG.
    await writeReceiptFile(claimId, "analyzed.svg", annotateReceipt({ data: receipt, mime }, extraction, ocr.text, ocr.source));

    const analyzedAt = new Date();
    const entry = auditEntryFor(result.findings, claim.department);
    const latencyMs = Date.now() - started;
    const exceptionRows = result.findings.map((f) => ({
      exceptionId: `EXC-${claimId.slice(4)}-${f.ruleId}`,
      claimId,
      anomalyType: f.anomalyType,
      riskLevel: f.riskLevel,
      ruleId: f.ruleId,
      points: f.points,
      message: f.message,
      evidence: JSON.stringify(f.evidence),
      status: "Open",
    }));
    const response: AuditResponse = {
      claim: { claimId, status: "Analyzed", riskScore: result.score, riskLevel: result.riskLevel, decision: result.decision, analyzedAt: analyzedAt.toISOString(), assignedRole: assignment?.role ?? null, assignedTo: assignment?.owner ?? null, assignmentExcluded: assignment?.excludedSubmitter ?? false },
      exceptions: exceptionRows.map(({ exceptionId, ruleId, anomalyType, riskLevel, points, message }) => ({ exceptionId, ruleId, anomalyType, riskLevel, points, message })),
      auditLog: entry,
      aiRun: { mode: run.mode, provider: run.provider, model: run.model, latencyMs, promptVersion: PROMPT_VERSION_EXTRACT },
      narrative,
      warnings,
    };
    const confidences = Object.values(extraction.fieldConfidence);
    // Provenance (D-37): which extraction was scored. Written on the claim (list views) and the run (history).
    const extractionSource = run.mode === "fallback" ? "fallback" : run.mode === "live" && !fixture ? "model" : "fixture";
    const runDetail = {
      modelExtraction,
      extractionDiff,
      fieldChecks: { scored: groundExtraction(extraction, ocr.text), model: modelExtraction ? groundExtraction(modelExtraction, ocr.text) : null },
      modelConfidence: modelExtraction ? { note: "model-reported, uncalibrated", fieldConfidence: modelExtraction.fieldConfidence } : null,
      stageMetrics: { ocrSource: ocr.source, ocrConfidence: ocr.confidence, extract: stage.extract, narrative: stage.narrative, totalLatencyMs: latencyMs },
    };

    // 10. One transaction: claim update, exceptions, audit log, AI run. All or nothing.
    try {
      await prisma.$transaction(async (tx) => {
        const updated = await tx.claim.updateMany({
          where: { claimId, status: "Pending" },
          data: {
            status: "Analyzed",
            analyzedAt,
            aiAnalyzedReceipt: `/api/receipts/${claimId}/analyzed`,
            extractedData: JSON.stringify(extraction),
            riskScore: result.score,
            riskLevel: result.riskLevel,
            decision: result.decision,
            receiptHash,
            ocrText: ocr.text,
            assignedRole: assignment?.role ?? null,
            assignedTo: assignment?.owner ?? null,
            assignedAt: assignment ? analyzedAt : null,
            extractionSource,
          },
        });
        if (updated.count !== 1) throw new AuditError(409, "CLAIM_NOT_PENDING", "Claim was analyzed by a concurrent request", { currentStatus: "Analyzed" });
        if (exceptionRows.length) await tx.exception.createMany({ data: exceptionRows });
        await tx.auditLog.create({
          data: {
            logId: randomUUID(),
            timestamp: analyzedAt,
            ...entry,
            claimId,
            metadata: JSON.stringify({ requestId: opts.requestId, initiatedBy: opts.initiatedBy ?? null, riskScore: result.score, riskLevel: result.riskLevel, decision: result.decision, mode: run.mode, rules: result.findings.map((f) => f.ruleId), assignedRole: assignment?.role ?? null, assignedTo: assignment?.owner ?? null, assignmentExcluded: assignment?.excludedSubmitter ?? false }),
          },
        });
        await tx.aiRun.create({
          data: {
            id: randomUUID(),
            claimId,
            mode: run.mode,
            provider: run.provider,
            model: run.model,
            promptVersion: run.mode === "live" ? `${PROMPT_VERSION_EXTRACT}+${PROMPT_VERSION_NARRATIVE}` : PROMPT_VERSION_EXTRACT,
            latencyMs,
            inputTokens: run.inputTokens,
            outputTokens: run.outputTokens,
            confidence: confidences.length ? Math.round((confidences.reduce((a, b) => a + b, 0) / confidences.length) * 1000) / 1000 : null,
            warnings: JSON.stringify(warnings),
            narrative,
            idempotencyKey: guardKey,
            requestKey: opts.idempotencyKey ?? null,
            responseJson: JSON.stringify(response),
            extractionSource,
            ocrConfidence: ocr.confidence,
            runDetail: runDetail as Prisma.InputJsonValue,
          },
        });
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")
        throw new AuditError(409, "CLAIM_NOT_PENDING", "Claim was analyzed by a concurrent request", { currentStatus: "Analyzed" });
      throw err;
    }

    console.info(JSON.stringify({ evt: "audit.complete", requestId: opts.requestId, claimId, mode: run.mode, provider: run.provider, model: run.model, latencyMs, inputTokens: run.inputTokens, outputTokens: run.outputTokens, findings: result.findings.length }));
    opts.revalidate?.(["/dashboard", "/claims", `/claims/${claimId}`, "/audit"]);
    return response;
  } finally {
    inFlight.delete(claimId);
  }
}

export type ClaimWithRefs = Prisma.ClaimGetPayload<{ include: { vendor: true; purchaseOrder: true; project: true } }>;

/** Exported for the economics layer (src/lib/economics/assess.ts); same logic the audit uses. */
export async function buildRiskInput(claim: ClaimWithRefs, extraction: Extraction): Promise<RiskInput> {
  const poNumber = claim.poNumber ?? extraction.poNumber;
  const po = claim.purchaseOrder ?? (poNumber ? await prisma.purchaseOrder.findUnique({ where: { poNumber } }) : null);
  const grnNumber = claim.grnNumber ?? extraction.grnNumber;
  const grn =
    (grnNumber ? await prisma.goodsReceipt.findUnique({ where: { grnNumber } }) : null) ??
    (po ? await prisma.goodsReceipt.findFirst({ where: { poNumber: po.poNumber } }) : null);
  const vendor = claim.vendor ?? (await prisma.vendor.findFirst({ where: { name: claim.vendorName } }));
  const policy = await prisma.policy.findUnique({ where: { category: claim.category } });
  if (!policy) throw new AuditError(422, "POLICY_MISSING", `No policy configured for ${claim.category}`);
  const benchmarks = await prisma.benchmark.findMany();
  const vendorKey = normalizeVendorName(claim.vendorName);
  const window = await prisma.claim.findMany({
    where: { claimId: { not: claim.claimId }, submittedAt: { gte: addDays(claim.submittedAt, -90), lt: claim.submittedAt } },
    select: { claimId: true, vendorName: true, invoiceNumber: true, amount: true, submittedAt: true },
  });

  return {
    claim: {
      claimId: claim.claimId,
      category: claim.category as Category,
      amountCents: toCents(claim.amount),
      currency: claim.currency,
      projectCode: claim.projectCode,
      poNumber,
      grnNumber,
      vendorName: claim.vendorName,
      invoiceNumber: claim.invoiceNumber ?? extraction.invoiceNumber,
      submittedAt: claim.submittedAt,
    },
    extraction,
    vendor: vendor && {
      name: vendor.name,
      approved: vendor.approved,
      w9OnFile: vendor.w9OnFile,
      w9ExpiresAt: vendor.w9ExpiresAt,
      insuranceExpiresAt: vendor.insuranceExpiresAt,
      bankName: vendor.bankName,
      bankAccountLast4: vendor.bankAccountLast4,
    },
    po: po && { poNumber: po.poNumber, projectCode: po.projectCode, amountCents: toCents(po.amount), consumedCents: toCents(po.consumedAmount), costType: po.costType, status: po.status },
    grn: grn && { grnNumber: grn.grnNumber, gatePassNumber: grn.gatePassNumber },
    policy: { category: policy.category, perClaimLimitCents: toCents(policy.perClaimLimit), requiresPo: policy.requiresPo, requiresGrn: policy.requiresGrn, requiresProjectCode: policy.requiresProjectCode },
    project: claim.project && { code: claim.project.code, endDate: claim.project.endDate },
    benchmarks: benchmarks.map((b) => ({ itemCode: b.itemCode, description: b.description, p50Cents: toCents(b.p50), p90Cents: toCents(b.p90) })),
    history: window
      .filter((h) => normalizeVendorName(h.vendorName) === vendorKey)
      .map((h) => ({ claimId: h.claimId, vendorName: h.vendorName, invoiceNumber: h.invoiceNumber, amountCents: toCents(h.amount), submittedAt: h.submittedAt })),
  };
}
