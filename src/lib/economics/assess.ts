import "server-only";
import { prisma } from "@/lib/db";
import { toCents } from "@/lib/domain/money";
import { parseExtractedData } from "@/lib/domain/schemas";
import { DEFAULT_ERROR_PROBABILITY, REVIEW_COST_CENTS } from "@/lib/domain/constants";
import { buildRiskInput } from "@/lib/audit/run-audit";
import { evaluateRisk } from "@/lib/risk/score";
import { claimExposure } from "@/lib/risk/exposure";
import { economicsFor, type Economics } from "@/lib/risk/economics";

// Bulk, read-only economics for every Analyzed claim with a stored extraction (docs/ECONOMICS.md).
// Findings are re-derived with the same pure engine and the same RiskInput the audit used; nothing is written.

export type AssessedClaim = {
  claimId: string;
  vendorName: string;
  amountCents: number;
  riskScore: number | null;
  riskLevel: string | null;
  decision: string | null;
  exposureCents: number;
  expectedLossCents: number;
  priority: number;
  action: Economics["action"];
  reason: Economics["reason"];
  extractionSource: string | null;
};

export async function assessClaims(opts: { probability?: number; reviewCostCents?: number } = {}): Promise<AssessedClaim[]> {
  const probability = opts.probability ?? DEFAULT_ERROR_PROBABILITY;
  const reviewCostCents = opts.reviewCostCents ?? REVIEW_COST_CENTS;
  const claims = await prisma.claim.findMany({
    where: { status: "Analyzed", extractedData: { not: null } },
    include: { vendor: true, purchaseOrder: true, project: true },
    orderBy: { claimId: "asc" },
  });
  const out: AssessedClaim[] = [];
  for (const claim of claims) {
    const parsed = parseExtractedData(claim.extractedData);
    if (!parsed?.ok) continue; // unreadable extraction: skip silently
    let input;
    try {
      input = await buildRiskInput(claim, parsed.data);
    } catch {
      continue; // e.g. no policy for the category
    }
    const { findings } = evaluateRisk(input);
    const exposure = claimExposure(findings, input);
    const e = economicsFor({ findings, exposureCents: exposure.cents, probability, reviewCostCents });
    out.push({
      claimId: claim.claimId,
      vendorName: claim.vendorName,
      amountCents: toCents(claim.amount),
      riskScore: claim.riskScore,
      riskLevel: claim.riskLevel,
      decision: claim.decision,
      exposureCents: e.exposureCents,
      expectedLossCents: e.expectedLossCents,
      priority: e.priority,
      action: e.action,
      reason: e.reason,
      extractionSource: claim.extractionSource,
    });
  }
  return out;
}
