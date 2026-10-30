import type { AnomalyType, Category, Decision, RiskLevel } from "@/lib/domain/constants";
import type { Extraction } from "@/lib/domain/schemas";

// Plain DTOs (money in integer cents) so the engine stays pure and Prisma-free.

export type ClaimInput = {
  claimId: string;
  category: Category;
  amountCents: number;
  currency: string;
  projectCode: string | null;
  poNumber: string | null;
  grnNumber: string | null;
  vendorName: string;
  invoiceNumber: string | null;
  submittedAt: Date;
};

export type VendorInput = {
  name: string;
  approved: boolean;
  w9OnFile: boolean;
  w9ExpiresAt: Date | null;
  insuranceExpiresAt: Date | null;
  bankName: string;
  bankAccountLast4: string;
};

export type PoInput = {
  poNumber: string;
  projectCode: string;
  amountCents: number;
  consumedCents: number;
  costType: string;
  status: string;
};

export type GrnInput = { grnNumber: string; gatePassNumber: string };

export type PolicyInput = {
  category: string;
  perClaimLimitCents: number;
  requiresPo: boolean;
  requiresGrn: boolean;
  requiresProjectCode: boolean;
};

export type BenchmarkInput = { itemCode: string; description: string; p50Cents: number; p90Cents: number };

export type ProjectInput = { code: string; endDate: Date | null };

export type HistoryClaim = {
  claimId: string;
  vendorName: string;
  invoiceNumber: string | null;
  amountCents: number;
  submittedAt: Date;
};

export type RiskInput = {
  claim: ClaimInput;
  extraction: Extraction;
  vendor: VendorInput | null;
  po: PoInput | null;
  grn: GrnInput | null;
  policy: PolicyInput;
  project: ProjectInput | null;
  benchmarks: BenchmarkInput[];
  /** Same vendor, last 90 days, excluding this claim. */
  history: HistoryClaim[];
};

export type Finding = {
  ruleId: string;
  anomalyType: AnomalyType;
  riskLevel: RiskLevel;
  points: number;
  message: string;
  evidence: Record<string, unknown>;
};

export type RiskResult = {
  score: number;
  riskLevel: RiskLevel;
  decision: Decision;
  findings: Finding[];
};
