import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import type { SessionUser } from "@/lib/auth/session";
import { formatUsd, toCents } from "@/lib/domain/money";
import { claimFiltersSchema } from "@/lib/domain/schemas";
import { dataAnchor, resolvePeriod } from "@/lib/kpi/queries";

// Grounded Q&A (docs/AI_GOVERNANCE.md, DECISIONS D-36). Runs in AI_MODE=mock (vitest.config.ts): no network.

let current: SessionUser | null = null;
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  requireUser: async () => current,
}));
const askWithDeepSeek = vi.fn<(q: string, facts: string, requestId: string) => Promise<string>>();
vi.mock("@/lib/ai/deepseek", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/deepseek")>()),
  askWithDeepSeek: (q: string, f: string, r: string) => askWithDeepSeek(q, f, r),
}));

const { retrieveFacts, detectIntent } = await import("@/lib/ask/retrieve");
const { answerQuestion, templateAnswer, validateModelAnswer, REFUSAL } = await import("@/lib/ask/answer");
const { POST: ask } = await import("@/app/api/ask/route");
type Facts = import("@/lib/ask/retrieve").Facts;

const reviewer: SessionUser = { id: "U-0002", name: "Priya Natarajan", email: "priya.natarajan@ironwood.example", role: "reviewer" };
const opts = { requestId: "test-ask" };
const askReq = (question: string) => ask(new Request("http://localhost/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question }) }));

// CLM-2026-0144's audited facts, built by hand: whether the shared test DB has audited 0144 yet depends on
// test-file order, so the template check must not depend on it.
const facts0144: Facts = {
  kind: "claim_status",
  claimIdAsked: "CLM-2026-0144",
  claim: {
    claimId: "CLM-2026-0144", status: "Analyzed", employee: "Priya Natarajan", department: "Plant Operations", vendorName: "Lone Star Robotics Integration",
    category: "MRO & Equipment Repair", amount: "$56,800.00", amountCents: 5_680_000, submittedOn: "2026-10-29", riskScore: 100, riskLevel: "High", decision: "ESCALATE",
    assignedTo: null, assignedRole: "Plant Controller", findingCount: 3,
    findings: [
      { ruleId: "R-04", anomalyType: "Amount Over Limit", points: 40, status: "Open", resolvedBy: null },
      { ruleId: "R-05", anomalyType: "Missing Factory Gate Pass", points: 30, status: "Open", resolvedBy: null },
      { ruleId: "R-07", anomalyType: "PO Balance Exceeded", points: 30, status: "Open", resolvedBy: null },
    ],
    po: { poNumber: "4500871", remaining: "$41,200.00" },
    policy: { category: "MRO & Equipment Repair", perClaimLimit: "$50,000.00", requiresPo: true, requiresGrn: true },
  },
};

beforeAll(() => {
  current = reviewer;
});
afterEach(() => {
  process.env.AI_MODE = "mock";
  delete process.env.DEEPSEEK_API_KEY;
  askWithDeepSeek.mockReset();
});
afterAll(() => prisma.$disconnect());

describe("intent detection (deterministic, no model)", () => {
  it.each([
    ["Why was CLM-2026-0144 flagged?", "claim_status"],
    ["status of clm-2026-0142", "claim_status"],
    ["How much did we spend with Lone Star Robotics?", "vendor_spend"],
    ["What should I review first?", "top_risks"],
    ["What are the biggest risks this month?", "top_risks"],
    ["What is the limit for Tooling & Dies?", "policy"],
    ["travel per diem", "policy"],
    ["Write me a poem about brake pads", "unknown"],
  ] as const)("%s → %s", async (q, kind) => {
    expect((await retrieveFacts(q, reviewer)).kind).toBe(kind);
  });

  it("vendor matching tolerates a missing legal suffix but not an unknown vendor", () => {
    const vendors = ["Lone Star Robotics Integration", "Buckeye Freight Systems"];
    expect(detectIntent("how much did we spend with Lone Star Robotics", vendors)).toBe("vendor_spend");
    expect(detectIntent("how much is a coffee", vendors)).toBe("unknown");
  });
});

describe("template answers (built only from Facts)", () => {
  it("the 0144 answer cites $56,800 and R-04", () => {
    const { answer, citations } = templateAnswer(facts0144);
    expect(answer).toContain("$56,800");
    expect(answer).toContain("R-04");
    expect(citations).toEqual(["CLM-2026-0144", "R-04", "R-05", "R-07"]);
  });

  it("a claim answer from the DB uses the stored amount and rule ids (CLM-2026-0077, no other test changes it)", async () => {
    const claim = await prisma.claim.findUniqueOrThrow({ where: { claimId: "CLM-2026-0077" }, include: { exceptions: true } });
    const res = await answerQuestion("Why was CLM-2026-0077 flagged?", await retrieveFacts("Why was CLM-2026-0077 flagged?", reviewer), opts);
    expect(res.source).toBe("template");
    expect(res.answer).toContain(formatUsd(toCents(claim.amount)));
    for (const e of claim.exceptions) expect(res.answer).toContain(e.ruleId);
  });

  it("vendor spend matches an independent sum over the same 12-month window", async () => {
    const vendorName = "Lone Star Robotics Integration";
    const period = resolvePeriod(claimFiltersSchema.parse({ range: "12m" }), await dataAnchor());
    const rows = await prisma.claim.findMany({ where: { vendorName, submittedAt: { gte: period.from, lt: period.to } }, select: { amount: true } });
    const total = formatUsd(rows.reduce((s, r) => s + toCents(r.amount), 0));
    const res = await answerQuestion("How much did we spend with Lone Star Robotics?", await retrieveFacts("How much did we spend with Lone Star Robotics?", reviewer), opts);
    expect(rows.length).toBeGreaterThan(0);
    expect(res.answer).toContain(total);
    expect(res.answer).toContain(`${rows.length} claim`);
  });

  it("policy answer returns the category's per-claim limit", async () => {
    const policy = await prisma.policy.findUniqueOrThrow({ where: { category: "Tooling & Dies" } });
    const res = await answerQuestion("What is the limit for Tooling & Dies?", await retrieveFacts("What is the limit for Tooling & Dies?", reviewer), opts);
    expect(res.answer).toContain(`per-claim limit ${formatUsd(toCents(policy.perClaimLimit))}`);
  });

  it("top risks lists at most 5 by score and 3 by priority, all real claim ids", async () => {
    const facts = await retrieveFacts("What should I review first?", reviewer);
    if (facts.kind !== "top_risks") throw new Error("expected top_risks");
    expect(facts.topByScore.length).toBeLessThanOrEqual(5);
    expect(facts.topByPriority.length).toBeLessThanOrEqual(3);
    const ids = [...facts.topByScore, ...facts.topByPriority].map((c) => c.claimId);
    expect(await prisma.claim.count({ where: { claimId: { in: ids } } })).toBe(new Set(ids).size);
  });

  it("a claim id that does not exist is reported as missing, not invented", async () => {
    const res = await answerQuestion("status of CLM-2026-9999", await retrieveFacts("status of CLM-2026-9999", reviewer), opts);
    expect(res.answer).toBe("I do not have a claim with id CLM-2026-9999.");
    expect(res.citations).toEqual([]);
  });

  it("unknown intent → the fixed refusal, from the template", async () => {
    const res = await answerQuestion("Write me a poem about brake pads", { kind: "unknown" }, opts);
    expect(res).toMatchObject({ answer: REFUSAL, source: "template", kind: "unknown", citations: [] });
  });
});

describe("citation check (live mode)", () => {
  const factsJson = JSON.stringify(facts0144);

  it("rejects an id that is not in the facts, and an invented dollar amount", () => {
    expect(validateModelAnswer("CLM-2026-0144 was flagged for R-04, like CLM-2026-9999.", factsJson)).toBeNull();
    expect(validateModelAnswer("CLM-2026-0144 was flagged for R-09.", factsJson)).toBeNull();
    expect(validateModelAnswer("CLM-2026-0144 is $60,000 over budget.", factsJson)).toBeNull();
    expect(validateModelAnswer("CLM-2026-0144 ($56,800) was flagged for R-04 and R-07; $41,200.00 remains on the PO.", factsJson)).toEqual(["CLM-2026-0144", "R-04", "R-07"]);
  });

  it("a model answer citing CLM-2026-9999 is discarded and the template is returned", async () => {
    process.env.AI_MODE = "live";
    process.env.DEEPSEEK_API_KEY = "test-key";
    askWithDeepSeek.mockResolvedValue("CLM-2026-0144 is a duplicate of CLM-2026-9999 (R-03).");
    const res = await answerQuestion("Why was CLM-2026-0144 flagged?", facts0144, opts);
    expect(askWithDeepSeek).toHaveBeenCalledOnce();
    expect(res.source).toBe("template");
    expect(res.answer).toBe(templateAnswer(facts0144).answer);
  });

  it("a grounded model answer is kept, with its cited ids", async () => {
    process.env.AI_MODE = "live";
    process.env.DEEPSEEK_API_KEY = "test-key";
    askWithDeepSeek.mockResolvedValue("CLM-2026-0144 ($56,800.00) breaches the limit (R-04) and has no gate pass (R-05).");
    const res = await answerQuestion("Why was CLM-2026-0144 flagged?", facts0144, opts);
    expect(res).toMatchObject({ source: "model", citations: ["CLM-2026-0144", "R-04", "R-05"] });
  });

  it("a provider failure falls back to the template", async () => {
    process.env.AI_MODE = "live";
    process.env.DEEPSEEK_API_KEY = "test-key";
    const { ProviderError } = await import("@/lib/ai/deepseek");
    askWithDeepSeek.mockRejectedValue(new ProviderError("DeepSeek returned 503", "http", 503));
    const res = await answerQuestion("Why was CLM-2026-0144 flagged?", facts0144, opts);
    expect(res.source).toBe("template");
  });
});

describe("POST /api/ask", () => {
  it("401 without a session", async () => {
    current = null;
    const res = await askReq("What should I review first?");
    current = reviewer;
    expect(res.status).toBe(401);
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });

  it("answers in mock mode from the template and writes exactly one AI Answer audit row", async () => {
    const before = await prisma.auditLog.count({ where: { action: "AI Answer" } });
    const res = await askReq("How much did we spend with Lone Star Robotics?");
    expect(res.status).toBe(200);
    expect(res.headers.get("x-request-id")).toBeTruthy();
    const body = (await res.json()) as { answer: string; citations: string[]; source: string };
    expect(body.source).toBe("template");
    expect(await prisma.auditLog.count({ where: { action: "AI Answer" } })).toBe(before + 1);
    const row = await prisma.auditLog.findFirstOrThrow({ where: { action: "AI Answer" }, orderBy: { timestamp: "desc" } });
    expect(row.details).toBe("How much did we spend with Lone Star Robotics?");
    expect(JSON.parse(row.metadata!)).toMatchObject({ kind: "vendor_spend", source: "template", citations: [] });
  });

  it("400 for a question shorter than 5 characters", async () => {
    expect((await askReq("hi")).status).toBe(400);
  });

  it("503 in live mode without a key", async () => {
    process.env.AI_MODE = "live";
    process.env.DEEPSEEK_API_KEY = "";
    expect((await askReq("What should I review first?")).status).toBe(503);
  });
});
