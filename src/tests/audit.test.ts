import { rm } from "node:fs/promises";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { AuditError, runAudit } from "@/lib/audit/run-audit";
import { receiptPath } from "@/lib/receipts/storage";

const opts = (extra: Partial<Parameters<typeof runAudit>[1]> = {}) => ({ requestId: "test", ...extra });
const aiLogs = (claimId: string) => prisma.auditLog.findMany({ where: { claimId, actor: "AI-RPA Agent" } });

afterAll(() => prisma.$disconnect());

describe("runAudit (integration, mock mode)", () => {
  it("clean claim CLM-2026-0142 writes the exact validated entry and status Analyzed", async () => {
    const revalidated: string[] = [];
    const res = await runAudit("CLM-2026-0142", opts({ revalidate: (p) => revalidated.push(...p) }));
    expect(res.claim).toMatchObject({ status: "Analyzed", riskScore: 0, riskLevel: "Low", decision: "AUTO_APPROVE" });
    expect(res.auditLog).toEqual({ actor: "AI-RPA Agent", action: "Automotive Expense Validated", details: "Invoice matched with SAP project code successfully." });
    expect(res.aiRun.mode).toBe("mock");
    expect(revalidated).toEqual(["/dashboard", "/claims", "/claims/CLM-2026-0142", "/audit"]);

    const claim = await prisma.claim.findUniqueOrThrow({ where: { claimId: "CLM-2026-0142" } });
    expect(claim.status).toBe("Analyzed");
    expect(claim.aiAnalyzedReceipt).toBe("/api/receipts/CLM-2026-0142/analyzed");
    expect(JSON.parse(claim.extractedData!).invoiceNumber).toBe("MPG-88214");
    const logs = await aiLogs("CLM-2026-0142");
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ action: "Automotive Expense Validated", details: "Invoice matched with SAP project code successfully." });
    expect(await prisma.exception.count({ where: { claimId: "CLM-2026-0142" } })).toBe(0);
  });

  it("second call returns 409 and writes nothing", async () => {
    const before = await prisma.auditLog.count();
    await expect(runAudit("CLM-2026-0142", opts())).rejects.toMatchObject({ status: 409, code: "CLAIM_NOT_PENDING" });
    expect(await prisma.auditLog.count()).toBe(before);
  });

  it("flagged claim CLM-2026-0144 creates exceptions and an accurate flagged log", async () => {
    const res = await runAudit("CLM-2026-0144", opts({ idempotencyKey: "itest-0144-key" }));
    expect(res.claim).toMatchObject({ riskScore: 100, riskLevel: "High", decision: "ESCALATE" });
    expect(res.auditLog.action).toBe("Automotive Expense Flagged");
    expect(res.auditLog.details).toBe(
      "AI-RPA raised 3 exception(s): Amount Over Limit (High), Missing Factory Gate Pass (High), PO Balance Exceeded (High). Routed to Plant Controller.",
    );
    const ex = await prisma.exception.findMany({ where: { claimId: "CLM-2026-0144" }, orderBy: { ruleId: "asc" } });
    expect(ex.map((e) => [e.ruleId, e.anomalyType, e.points, e.status])).toEqual([
      ["R-04", "Amount Over Limit", 40, "Open"],
      ["R-05", "Missing Factory Gate Pass", 30, "Open"],
      ["R-07", "PO Balance Exceeded", 30, "Open"],
    ]);
    expect(JSON.parse(ex[2].evidence!)).toMatchObject({ remaining: "$41,200.00", shortfall: "$15,600.00" });
    const logs = await aiLogs("CLM-2026-0144");
    expect(logs.some((l) => l.details.includes("matched with SAP project code successfully"))).toBe(false);
  });

  it("same Idempotency-Key replays the original result without new rows", async () => {
    const counts = async () => [await prisma.exception.count(), await prisma.auditLog.count(), await prisma.aiRun.count()];
    const before = await counts();
    const replay = await runAudit("CLM-2026-0144", opts({ idempotencyKey: "itest-0144-key" }));
    expect(replay.claim.riskScore).toBe(100);
    expect(await counts()).toEqual(before);
  });

  it("concurrent audits of one claim: one wins, the other gets 409", async () => {
    const results = await Promise.allSettled([runAudit("CLM-2026-0145", opts()), runAudit("CLM-2026-0145", opts())]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(AuditError);
    expect(rejected.reason.status).toBe(409);
    expect(await prisma.exception.count({ where: { claimId: "CLM-2026-0145" } })).toBe(1);
    expect(await aiLogs("CLM-2026-0145")).toHaveLength(1);
  });

  it("missing receipt → 422, claim stays Pending, no partial exceptions or AI log", async () => {
    await rm(receiptPath("CLM-2026-0147", "original.svg"));
    await expect(runAudit("CLM-2026-0147", opts())).rejects.toMatchObject({ status: 422, code: "RECEIPT_MISSING" });
    const claim = await prisma.claim.findUniqueOrThrow({ where: { claimId: "CLM-2026-0147" } });
    expect(claim.status).toBe("Pending");
    expect(claim.extractedData).toBeNull();
    expect(await prisma.exception.count({ where: { claimId: "CLM-2026-0147" } })).toBe(0);
    expect(await aiLogs("CLM-2026-0147")).toHaveLength(0);
    expect(await prisma.auditLog.count({ where: { claimId: "CLM-2026-0147", action: "Audit Failed" } })).toBe(1);
  });

  it("unknown claim → 404", async () => {
    await expect(runAudit("CLM-2026-9999", opts())).rejects.toMatchObject({ status: 404 });
  });

  it("live mode without a key → 503 and nothing written", async () => {
    process.env.AI_MODE = "live";
    process.env.DEEPSEEK_API_KEY = "";
    try {
      await expect(runAudit("CLM-2026-0146", opts())).rejects.toMatchObject({ status: 503, message: "AI provider is not configured" });
      expect((await prisma.claim.findUniqueOrThrow({ where: { claimId: "CLM-2026-0146" } })).status).toBe("Pending");
    } finally {
      process.env.AI_MODE = "mock";
    }
  });
});
