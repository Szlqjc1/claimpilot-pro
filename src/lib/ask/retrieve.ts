import "server-only";
import { prisma } from "@/lib/db";
import { CATEGORIES, DEPARTMENTS, ENTERTAINMENT_POLICY, TRAVEL_POLICY, type Category, type Department } from "@/lib/domain/constants";
import { formatUsd, toCents } from "@/lib/domain/money";
import { toIsoDate } from "@/lib/domain/dates";
import { claimFiltersSchema } from "@/lib/domain/schemas";
import { claimWhere, dataAnchor, resolvePeriod, withPeriod } from "@/lib/kpi/queries";
import { normalizeVendorName } from "@/lib/risk/rules";
import { assessClaims } from "@/lib/economics/assess";

// Retrieval for grounded Q&A (docs/AI_GOVERNANCE.md, DECISIONS D-36). Intent detection is deterministic
// (no model call). Facts hold only values read from the database or constants; anything not found is null.
// Every list is capped at MAX_ROWS so the prompt and the answer stay small.

const MAX_ROWS = 5;

export type ClaimFacts = {
  kind: "claim_status";
  claimIdAsked: string;
  claim: null | {
    claimId: string;
    status: string;
    employee: string;
    department: string;
    vendorName: string;
    category: string;
    amount: string;
    amountCents: number;
    submittedOn: string;
    riskScore: number | null;
    riskLevel: string | null;
    decision: string | null;
    assignedTo: string | null;
    assignedRole: string | null;
    findingCount: number;
    findings: { ruleId: string; anomalyType: string; points: number; status: string; resolvedBy: string | null }[];
    po: { poNumber: string; remaining: string } | null;
    policy: { category: string; perClaimLimit: string; requiresPo: boolean; requiresGrn: boolean } | null;
  };
};
export type VendorFacts = {
  kind: "vendor_spend";
  vendorAsked: string | null;
  vendor: null | { name: string; period: string; total: string; totalCents: number; claimCount: number; latestSubmittedOn: string | null; topCategory: string | null };
};
export type TopRiskFacts = {
  kind: "top_risks";
  period: string;
  department: string | null;
  topByScore: { claimId: string; vendorName: string; amount: string; riskScore: number; riskLevel: string | null; decision: string | null }[];
  topByPriority: { claimId: string; vendorName: string; amount: string; expectedLoss: string; action: string; reason: string }[];
};
export type PolicyFacts = {
  kind: "policy";
  category: string | null;
  policy: null | { category: string; perClaimLimit: string; approvalThreshold: string; requiresPo: boolean; requiresGrn: boolean; requiresProjectCode: boolean };
  travel: null | { lodgingCapPerNight: string; airfareCap: string; perDiem: string; economyOnly: boolean };
  entertainment: null | { perHeadCap: string; attendeeListRequired: boolean; alcoholDiscouraged: boolean };
};
export type UnknownFacts = { kind: "unknown" };
export type Facts = ClaimFacts | VendorFacts | TopRiskFacts | PolicyFacts | UnknownFacts;

export type Intent = Facts["kind"];

const norm = (s: string) => s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
const has = (haystack: string, needle: string) => ` ${haystack} `.includes(` ${needle} `);

const CLAIM_ID = /CLM-\d{4}-\d{4}/i;
const POLICY_WORDS = /\b(limit|limits|policy|policies|cap|caps|per diem|lodging|hotel|airfare|threshold|allowed|maximum|max|per head)\b/i;
const SPEND_WORDS = /\b(spend|spent|spending|paid|pay|purchased|bought|invoiced)\b/i;
const RISK_WORDS = /\b(risk|risks|risky|riskiest|review first|look at first|priorit\w*|urgent|biggest|worst)\b/i;
const TRAVEL_WORDS = /\b(travel|per diem|lodging|hotel|airfare|flight)\b/i;
const ENTERTAINMENT_WORDS = /\b(entertainment|per head|meal|meals|dinner|alcohol)\b/i;

export function findCategory(question: string): Category | null {
  const q = norm(question);
  return [...CATEGORIES].sort((a, b) => b.length - a.length).find((c) => has(q, norm(c))) ?? null;
}
export function findDepartment(question: string): Department | null {
  const q = norm(question);
  return DEPARTMENTS.find((d) => has(q, norm(d))) ?? null;
}
/** Match a known vendor: the full normalized name, or (for 3+ word names) all but the last word. Longest wins. */
export function findVendor(question: string, vendors: readonly string[]): string | null {
  const q = normalizeVendorName(question);
  let best: { name: string; len: number } | null = null;
  for (const name of vendors) {
    const tokens = normalizeVendorName(name).split(" ").filter(Boolean);
    const candidates = [tokens.join(" ")];
    if (tokens.length >= 3) candidates.push(tokens.slice(0, -1).join(" "));
    for (const c of candidates) if (c && has(q, c) && (!best || c.length > best.len)) best = { name, len: c.length };
  }
  return best?.name ?? null;
}

/** Deterministic intent rules, in priority order. `vendors` is the list already loaded from the DB. */
export function detectIntent(question: string, vendors: readonly string[]): Intent {
  if (CLAIM_ID.test(question)) return "claim_status";
  if (POLICY_WORDS.test(question) && (findCategory(question) || TRAVEL_WORDS.test(question) || ENTERTAINMENT_WORDS.test(question))) return "policy";
  if (SPEND_WORDS.test(question) || (/how much/i.test(question) && findVendor(question, vendors))) return "vendor_spend";
  if (RISK_WORDS.test(question)) return "top_risks";
  return "unknown";
}

async function vendorNames(): Promise<string[]> {
  const [master, claims] = await Promise.all([prisma.vendor.findMany({ select: { name: true } }), prisma.claim.findMany({ distinct: ["vendorName"], select: { vendorName: true } })]);
  return [...new Set([...master.map((v) => v.name), ...claims.map((c) => c.vendorName)])];
}

async function claimFacts(claimId: string): Promise<ClaimFacts> {
  const c = await prisma.claim.findUnique({
    where: { claimId },
    include: { exceptions: { orderBy: { ruleId: "asc" } }, purchaseOrder: true },
  });
  if (!c) return { kind: "claim_status", claimIdAsked: claimId, claim: null };
  const policy = await prisma.policy.findUnique({ where: { category: c.category } });
  return {
    kind: "claim_status",
    claimIdAsked: claimId,
    claim: {
      claimId: c.claimId,
      status: c.status,
      employee: c.employee,
      department: c.department,
      vendorName: c.vendorName,
      category: c.category,
      amount: formatUsd(toCents(c.amount)),
      amountCents: toCents(c.amount),
      submittedOn: toIsoDate(c.submittedAt),
      riskScore: c.riskScore,
      riskLevel: c.riskLevel,
      decision: c.decision,
      assignedTo: c.assignedTo,
      assignedRole: c.assignedRole,
      findingCount: c.exceptions.length,
      findings: c.exceptions.slice(0, MAX_ROWS).map((e) => ({ ruleId: e.ruleId, anomalyType: e.anomalyType, points: e.points, status: e.status, resolvedBy: e.resolvedBy })),
      po: c.purchaseOrder ? { poNumber: c.purchaseOrder.poNumber, remaining: formatUsd(toCents(c.purchaseOrder.amount) - toCents(c.purchaseOrder.consumedAmount)) } : null,
      policy: policy ? { category: policy.category, perClaimLimit: formatUsd(toCents(policy.perClaimLimit)), requiresPo: policy.requiresPo, requiresGrn: policy.requiresGrn } : null,
    },
  };
}

async function vendorFacts(question: string, vendors: string[]): Promise<VendorFacts> {
  const name = findVendor(question, vendors);
  if (!name) return { kind: "vendor_spend", vendorAsked: null, vendor: null };
  const filters = claimFiltersSchema.parse({ vendor: name, range: "12m" });
  const period = resolvePeriod(filters, await dataAnchor());
  const where = withPeriod(claimWhere(filters), period.from, period.to);
  const rows = await prisma.claim.findMany({ where, select: { amount: true, category: true, submittedAt: true } });
  const byCategory = new Map<string, number>();
  for (const r of rows) byCategory.set(r.category, (byCategory.get(r.category) ?? 0) + toCents(r.amount));
  const totalCents = rows.reduce((s, r) => s + toCents(r.amount), 0);
  const latest = rows.reduce<Date | null>((d, r) => (!d || r.submittedAt > d ? r.submittedAt : d), null);
  const top = [...byCategory.entries()].sort((a, b) => b[1] - a[1])[0];
  return {
    kind: "vendor_spend",
    vendorAsked: name,
    vendor: { name, period: period.label, total: formatUsd(totalCents), totalCents, claimCount: rows.length, latestSubmittedOn: latest ? toIsoDate(latest) : null, topCategory: top?.[0] ?? null },
  };
}

async function topRiskFacts(question: string): Promise<TopRiskFacts> {
  const department = findDepartment(question);
  const filters = claimFiltersSchema.parse({ department: department ?? undefined, status: "Analyzed", range: /this month|30 days/i.test(question) ? "30d" : "12m" });
  const period = resolvePeriod(filters, await dataAnchor());
  const where = withPeriod({ AND: [claimWhere(filters), { riskScore: { not: null } }] }, period.from, period.to);
  const byScore = await prisma.claim.findMany({ where, orderBy: [{ riskScore: "desc" }, { amount: "desc" }], take: MAX_ROWS });
  const assessed = await assessClaims();
  const deptIds = department ? new Set((await prisma.claim.findMany({ where: { department, status: "Analyzed" }, select: { claimId: true } })).map((c) => c.claimId)) : null;
  const topByPriority = assessed
    .filter((a) => !deptIds || deptIds.has(a.claimId))
    .sort((a, b) => b.priority - a.priority || b.exposureCents - a.exposureCents)
    .slice(0, 3)
    .map((a) => ({ claimId: a.claimId, vendorName: a.vendorName, amount: formatUsd(a.amountCents), expectedLoss: formatUsd(Math.round(a.expectedLossCents)), action: a.action, reason: a.reason }));
  return {
    kind: "top_risks",
    period: period.label,
    department,
    topByScore: byScore.map((c) => ({ claimId: c.claimId, vendorName: c.vendorName, amount: formatUsd(toCents(c.amount)), riskScore: c.riskScore ?? 0, riskLevel: c.riskLevel, decision: c.decision })),
    topByPriority,
  };
}

async function policyFacts(question: string): Promise<PolicyFacts> {
  const category = findCategory(question);
  const row = category ? await prisma.policy.findUnique({ where: { category } }) : null;
  const travel = TRAVEL_WORDS.test(question) || category === "Supplier Audit Travel";
  const entertainment = ENTERTAINMENT_WORDS.test(question) || category === "Client Entertainment";
  return {
    kind: "policy",
    category,
    policy: row
      ? {
          category: row.category,
          perClaimLimit: formatUsd(toCents(row.perClaimLimit)),
          approvalThreshold: formatUsd(toCents(row.approvalThreshold)),
          requiresPo: row.requiresPo,
          requiresGrn: row.requiresGrn,
          requiresProjectCode: row.requiresProjectCode,
        }
      : null,
    travel: travel
      ? { lodgingCapPerNight: formatUsd(TRAVEL_POLICY.lodgingCapPerNightCents), airfareCap: formatUsd(TRAVEL_POLICY.airfareCapCents), perDiem: formatUsd(TRAVEL_POLICY.perDiemCents), economyOnly: TRAVEL_POLICY.economyOnly }
      : null,
    entertainment: entertainment
      ? { perHeadCap: formatUsd(ENTERTAINMENT_POLICY.perHeadCapCents), attendeeListRequired: ENTERTAINMENT_POLICY.attendeeListRequired, alcoholDiscouraged: ENTERTAINMENT_POLICY.alcoholDiscouraged }
      : null,
  };
}

/** Deterministic retrieval: intent by rules, facts from the DB. `user` is accepted for future scoping; all signed-in users may read. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- part of the contract; reserved for per-user scoping
export async function retrieveFacts(question: string, _user: { name: string; role: string }): Promise<Facts> {
  const vendors = await vendorNames();
  const kind = detectIntent(question, vendors);
  switch (kind) {
    case "claim_status":
      return claimFacts(question.match(CLAIM_ID)![0].toUpperCase());
    case "vendor_spend":
      return vendorFacts(question, vendors);
    case "top_risks":
      return topRiskFacts(question);
    case "policy":
      return policyFacts(question);
    default:
      return { kind: "unknown" };
  }
}
