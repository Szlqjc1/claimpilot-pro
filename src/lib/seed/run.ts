import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import type { Prisma, PrismaClient } from "@prisma/client";
import { CATEGORIES, PROMPT_VERSION_EXTRACT, type Category } from "@/lib/domain/constants";
import { centsToDecimalString, formatUsd } from "@/lib/domain/money";
import { isoDate } from "@/lib/domain/dates";
import { buildFixture, totalCents } from "@/lib/receipts/invoice";
import { receiptsRoot, writeReceiptFile } from "@/lib/receipts/storage";
import { annotateReceipt } from "@/lib/ai/annotate";
import { templateNarrative } from "@/lib/ai/narrative";
import { auditEntryFor } from "@/lib/audit/wording";
import { miroDocNo } from "@/lib/audit/miro";
import { evaluateRisk } from "@/lib/risk/score";
import type { HistoryClaim, RiskInput, RiskResult } from "@/lib/risk/types";
import type { ReceiptFixture } from "@/lib/domain/schemas";
import { resolveAssignment } from "@/lib/domain/routing";
import { BENCHMARKS, EMPLOYEES, OPEN_GRNS, OPEN_POS, POLICIES, PROJECTS, VENDORS, policyFor, vendorByName, type PoSeed } from "./master";
import { HERO_CLAIMS } from "./heroes";
import { generateHistorical } from "./historical";
import type { ClaimSeed } from "./types";

const HERO_AMOUNTS: Record<string, number> = {
  "CLM-2026-0142": 1_450_000,
  "CLM-2026-0143": 324_000,
  "CLM-2026-0144": 5_680_000,
  "CLM-2026-0145": 632_000,
  "CLM-2026-0146": 1_875_000,
  "CLM-2026-0147": 245_157,
  "CLM-2026-0148": 12_840_000,
};

const DAY = 86_400_000;

export type SeedPlan = {
  claims: ClaimSeed[];
  pos: PoSeed[];
  grns: typeof OPEN_GRNS;
  fixtures: Map<string, { svg: string; fixture: ReceiptFixture; hash: string }>;
};

/** Build the full deterministic dataset in memory (no DB, no disk). */
export function buildSeedPlan(): SeedPlan {
  const hist = generateHistorical();
  const claims = [...hist.claims, ...HERO_CLAIMS.map((h) => ({ ...h }))].sort((a, b) => a.submittedAt.getTime() - b.submittedAt.getTime());
  const fixtures = new Map<string, { svg: string; fixture: ReceiptFixture; hash: string }>();
  for (const c of claims) {
    const built = buildFixture(c.doc);
    const amount = totalCents(c.doc);
    // Seed-time assertion: fixture total == SVG total == claim amount.
    if (Math.round(built.fixture.extraction.total * 100) !== amount) throw new Error(`Fixture total mismatch on ${c.claimId}`);
    if (HERO_AMOUNTS[c.claimId] !== undefined && HERO_AMOUNTS[c.claimId] !== amount)
      throw new Error(`${c.claimId} amount ${formatUsd(amount)} != spec ${formatUsd(HERO_AMOUNTS[c.claimId])}`);
    fixtures.set(c.claimId, built);
  }
  return { claims, pos: [...OPEN_POS, ...hist.pos], grns: [...OPEN_GRNS, ...hist.grns], fixtures };
}

/** Risk input for a seeded claim, using the PO balance as it stood before this claim was posted. */
export function seedRiskInput(plan: SeedPlan, claim: ClaimSeed): RiskInput {
  const amount = totalCents(claim.doc);
  const po = claim.poNumber ? plan.pos.find((p) => p.poNumber === claim.poNumber) : undefined;
  const grn = claim.grnNumber
    ? plan.grns.find((g) => g.grnNumber === claim.grnNumber)
    : claim.poNumber
      ? plan.grns.find((g) => g.poNumber === claim.poNumber)
      : undefined;
  const vendor = VENDORS.find((v) => v.name === claim.vendorName) ?? null;
  const project = PROJECTS.find((p) => p.code === claim.projectCode) ?? null;
  const policy = policyFor(claim.category);
  const t = claim.submittedAt.getTime();
  const history: HistoryClaim[] = plan.claims
    .filter((c) => c.claimId !== claim.claimId && c.vendorName === claim.vendorName && c.submittedAt.getTime() < t && c.submittedAt.getTime() >= t - 90 * DAY)
    .map((c) => ({ claimId: c.claimId, vendorName: c.vendorName, invoiceNumber: c.doc.invoiceNumber, amountCents: totalCents(c.doc), submittedAt: c.submittedAt }));
  return {
    claim: {
      claimId: claim.claimId,
      category: claim.category,
      amountCents: amount,
      currency: "USD",
      projectCode: claim.projectCode,
      poNumber: claim.poNumber,
      grnNumber: claim.grnNumber,
      vendorName: claim.vendorName,
      invoiceNumber: claim.doc.invoiceNumber,
      submittedAt: claim.submittedAt,
    },
    extraction: plan.fixtures.get(claim.claimId)!.fixture.extraction,
    vendor: vendor && {
      name: vendor.name,
      approved: vendor.approved,
      w9OnFile: vendor.w9OnFile,
      w9ExpiresAt: vendor.w9ExpiresAt ? isoDate(vendor.w9ExpiresAt) : null,
      insuranceExpiresAt: vendor.insuranceExpiresAt ? isoDate(vendor.insuranceExpiresAt) : null,
      bankName: vendor.bankName,
      bankAccountLast4: vendor.bankAccountLast4,
    },
    po: po
      ? {
          poNumber: po.poNumber,
          projectCode: po.projectCode,
          amountCents: po.amountCents,
          consumedCents: claim.status === "Posted" ? Math.max(0, po.consumedCents - amount) : po.consumedCents,
          costType: po.costType,
          status: po.status,
        }
      : null,
    grn: grn ? { grnNumber: grn.grnNumber, gatePassNumber: grn.gatePassNumber } : null,
    policy: { category: policy.category, perClaimLimitCents: policy.perClaimLimitCents, requiresPo: policy.requiresPo, requiresGrn: policy.requiresGrn, requiresProjectCode: policy.requiresProjectCode },
    project: project ? { code: project.code, endDate: project.endDate ? isoDate(project.endDate) : null } : null,
    benchmarks: BENCHMARKS.map((b) => ({ itemCode: b.itemCode, description: b.description, p50Cents: b.p50Cents, p90Cents: b.p90Cents })),
    history,
  };
}

export type SeedSummary = {
  claims: number;
  byStatus: Record<string, number>;
  categories: number;
  flaggedHistorical: number;
  unexpectedFindings: string[];
};

export async function seedDatabase(prisma: PrismaClient, opts: { log?: (msg: string) => void } = {}): Promise<SeedSummary> {
  const log = opts.log ?? (() => {});
  const plan = buildSeedPlan();

  // Hero expectations are checked before anything is written.
  for (const h of HERO_CLAIMS) {
    const res = evaluateRisk(seedRiskInput(plan, plan.claims.find((c) => c.claimId === h.claimId)!));
    const exp = h.expected!;
    if (res.score !== exp.score || res.riskLevel !== exp.level || res.decision !== exp.decision) {
      throw new Error(`${h.claimId} expected ${exp.score}/${exp.level}/${exp.decision}, got ${res.score}/${res.riskLevel}/${res.decision}: ${res.findings.map((f) => f.ruleId).join(",")}`);
    }
  }

  log("Clearing tables…");
  await prisma.$transaction([
    prisma.aiRun.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.exception.deleteMany(),
    prisma.claim.deleteMany(),
    prisma.goodsReceipt.deleteMany(),
    prisma.purchaseOrder.deleteMany(),
    prisma.benchmark.deleteMany(),
    prisma.policy.deleteMany(),
    prisma.project.deleteMany(),
    prisma.vendor.deleteMany(),
    prisma.employee.deleteMany(),
  ]);
  await rm(receiptsRoot(), { recursive: true, force: true });

  log("Master data…");
  await prisma.employee.createMany({ data: EMPLOYEES });
  await prisma.project.createMany({
    data: PROJECTS.map((p) => ({
      code: p.code,
      name: p.name,
      department: p.department,
      budget: centsToDecimalString(p.budgetCents),
      startDate: isoDate(p.startDate),
      endDate: p.endDate ? isoDate(p.endDate) : null,
      customerProgram: p.customerProgram,
      status: p.status,
    })),
  });
  await prisma.vendor.createMany({
    data: VENDORS.map((v) => ({
      vendorId: v.vendorId,
      name: v.name,
      category: v.category,
      city: v.city,
      state: v.state,
      country: "US",
      taxId: v.taxId,
      approved: v.approved,
      w9OnFile: v.w9OnFile,
      w9ExpiresAt: v.w9ExpiresAt ? isoDate(v.w9ExpiresAt) : null,
      insuranceExpiresAt: v.insuranceExpiresAt ? isoDate(v.insuranceExpiresAt) : null,
      paymentTerms: v.paymentTerms,
      bankName: v.bankName,
      bankAccountLast4: v.bankAccountLast4,
    })),
  });
  await prisma.policy.createMany({
    data: POLICIES.map((p) => ({
      category: p.category,
      perClaimLimit: centsToDecimalString(p.perClaimLimitCents),
      requiresPo: p.requiresPo,
      requiresGrn: p.requiresGrn,
      requiresProjectCode: p.requiresProjectCode,
      approvalThreshold: centsToDecimalString(p.approvalThresholdCents),
      notes: p.notes,
    })),
  });
  await prisma.benchmark.createMany({
    data: BENCHMARKS.map((b) => ({
      itemCode: b.itemCode,
      category: b.category,
      description: b.description,
      unit: b.unit,
      p50: centsToDecimalString(b.p50Cents),
      p90: centsToDecimalString(b.p90Cents),
      effectiveDate: isoDate("2026-01-01"),
      source: "Ironwood strategic sourcing index FY2026 (synthetic)",
    })),
  });
  await prisma.purchaseOrder.createMany({
    data: plan.pos.map((p) => ({
      poNumber: p.poNumber,
      vendorId: vendorByName(p.vendor).vendorId,
      projectCode: p.projectCode,
      amount: centsToDecimalString(p.amountCents),
      consumedAmount: centsToDecimalString(p.consumedCents),
      costType: p.costType,
      issuedAt: isoDate(p.issuedAt),
      status: p.status,
      description: p.description,
    })),
  });
  await prisma.goodsReceipt.createMany({
    data: plan.grns.map((g) => ({
      grnNumber: g.grnNumber,
      poNumber: g.poNumber,
      gatePassNumber: g.gatePassNumber,
      receivedAt: isoDate(g.receivedAt),
      quantity: g.quantity,
      amount: centsToDecimalString(g.amountCents),
      plant: g.plant,
    })),
  });

  log(`Receipts + claims (${plan.claims.length})…`);
  const unexpected: string[] = [];
  let flagged = 0;
  const claimRows: Prisma.ClaimCreateManyInput[] = [];
  const exceptionRows: Prisma.ExceptionCreateManyInput[] = [];
  const logRows: Prisma.AuditLogCreateManyInput[] = [];
  const runRows: Prisma.AiRunCreateManyInput[] = [];

  for (const c of plan.claims) {
    const { svg, fixture, hash } = plan.fixtures.get(c.claimId)!;
    await writeReceiptFile(c.claimId, "original.svg", svg);
    await writeReceiptFile(c.claimId, "fixture.json", JSON.stringify(fixture, null, 2));
    const amount = totalCents(c.doc);
    const vendor = vendorByName(c.vendorName);

    logRows.push({
      logId: randomUUID(),
      timestamp: c.submittedAt,
      actor: c.employee,
      action: "Claim Submitted",
      details: `Claim submitted by ${c.employee}`,
      claimId: c.claimId,
      metadata: JSON.stringify({ amount: formatUsd(amount), category: c.category, invoice: c.doc.invoiceNumber }),
    });

    let result: RiskResult | null = null;
    let analyzedAt: Date | null = null;
    if (c.status !== "Pending") {
      result = evaluateRisk(seedRiskInput(plan, c));
      analyzedAt = new Date(c.submittedAt.getTime() + (c.cycleHours ?? 4) * 3_600_000);
      const annotated = annotateReceipt({ data: Buffer.from(svg), mime: "image/svg+xml" }, fixture.extraction);
      await writeReceiptFile(c.claimId, "analyzed.svg", annotated);
      if (result.findings.length > 0) flagged++;
      if (!c.plannedAnomaly && result.findings.length > 0) unexpected.push(`${c.claimId} (${c.category}): ${result.findings.map((f) => f.ruleId).join(",")}`);

      const exStatus = c.status === "Posted" ? "Resolved" : "Open";
      result.findings.forEach((f) =>
        exceptionRows.push({
          exceptionId: `EXC-${c.claimId.slice(4)}-${f.ruleId}`,
          claimId: c.claimId,
          anomalyType: f.anomalyType,
          riskLevel: f.riskLevel,
          ruleId: f.ruleId,
          points: f.points,
          message: f.message,
          evidence: JSON.stringify(f.evidence),
          status: exStatus === "Resolved" && f.riskLevel === "Low" ? "Waived" : exStatus,
          createdAt: analyzedAt!,
        }),
      );
      const entry = auditEntryFor(result.findings, c.department);
      logRows.push({
        logId: randomUUID(),
        timestamp: analyzedAt,
        ...entry,
        claimId: c.claimId,
        metadata: JSON.stringify({ riskScore: result.score, riskLevel: result.riskLevel, decision: result.decision, mode: "mock" }),
      });
      const confidences = Object.values(fixture.extraction.fieldConfidence);
      runRows.push({
        id: randomUUID(),
        claimId: c.claimId,
        mode: "mock",
        provider: "fixture",
        model: "fixture-ocr + deterministic-rules",
        promptVersion: PROMPT_VERSION_EXTRACT,
        latencyMs: 280 + (amount % 600),
        inputTokens: 0,
        outputTokens: 0,
        confidence: Math.round((confidences.reduce((a, b) => a + b, 0) / confidences.length) * 1000) / 1000,
        warnings: JSON.stringify(fixture.extraction.warnings),
        narrative: templateNarrative(result, { claimId: c.claimId, vendorName: c.vendorName, amountCents: amount }),
        idempotencyKey: `${c.claimId}:${hash}:${PROMPT_VERSION_EXTRACT}`,
        createdAt: analyzedAt,
      });
      if (c.status === "Posted" && c.postedAt) {
        if (result.findings.length > 0) {
          logRows.push({
            logId: randomUUID(),
            timestamp: new Date(c.postedAt.getTime() - 2 * 3_600_000),
            actor: "AP Shared Services",
            action: "Exceptions Cleared Before Posting",
            details: `${result.findings.length} exception(s) resolved after reviewer sign-off; supplier documentation attached.`,
            claimId: c.claimId,
            metadata: null,
          });
        }
        logRows.push({
          logId: randomUUID(),
          timestamp: c.postedAt,
          actor: "SAP S/4HANA Integration",
          action: "Posted to SAP",
          details: `Invoice ${c.doc.invoiceNumber} posted (MIRO) for ${formatUsd(amount)}; payment run ${vendor.paymentTerms}.`,
          claimId: c.claimId,
          metadata: null,
        });
      }
    }

    const assignment = result ? resolveAssignment(c.department, result.findings.length, EMPLOYEES, c.employee) : null;
    claimRows.push({
      claimId: c.claimId,
      employee: c.employee,
      department: c.department,
      projectCode: c.projectCode,
      category: c.category,
      amount: centsToDecimalString(amount),
      currency: "USD",
      status: c.status,
      originalReceipt: `/api/receipts/${c.claimId}/original`,
      aiAnalyzedReceipt: result ? `/api/receipts/${c.claimId}/analyzed` : null,
      extractedData: result ? JSON.stringify(fixture.extraction) : null,
      vendorId: vendor.vendorId,
      vendorName: c.vendorName,
      invoiceNumber: c.doc.invoiceNumber,
      poNumber: c.poNumber,
      grnNumber: c.grnNumber,
      receiptHash: hash,
      receiptMime: "image/svg+xml",
      receiptName: "original.svg",
      source: "seed",
      submittedAt: c.submittedAt,
      analyzedAt,
      riskScore: result?.score ?? null,
      riskLevel: result?.riskLevel ?? null,
      decision: result?.decision ?? null,
      postedAt: c.status === "Posted" ? (c.postedAt ?? null) : null,
      miroDocNo: c.status === "Posted" && c.postedAt ? miroDocNo(c.postedAt, hash) : null,
      ocrText: result ? fixture.ocrText : null,
      assignedRole: assignment?.role ?? null,
      assignedTo: assignment?.owner ?? null,
      assignedAt: assignment ? analyzedAt : null,
    });
  }

  await prisma.claim.createMany({ data: claimRows });
  await prisma.exception.createMany({ data: exceptionRows });
  await prisma.auditLog.createMany({ data: logRows });
  await prisma.aiRun.createMany({ data: runRows });

  const byStatus: Record<string, number> = {};
  for (const c of plan.claims) byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
  const cats = new Set<Category>(plan.claims.map((c) => c.category));
  if (cats.size !== CATEGORIES.length) throw new Error(`Only ${cats.size} categories seeded`);
  return { claims: plan.claims.length, byStatus, categories: cats.size, flaggedHistorical: flagged, unexpectedFindings: unexpected };
}
