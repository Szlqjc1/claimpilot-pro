import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import type { SessionUser } from "@/lib/auth/session";

// Reviewer dispositions as one enum (D-39): Resolved = real, corrected; Waived = real, accepted;
// Dismissed = the rule was wrong. Self-contained fixture claims; no seeded ids.

const reviewer: SessionUser = { id: "U-T39", name: "Disposition Test Reviewer", email: "disp@test.example", role: "reviewer" };
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  requireUser: async () => reviewer,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { dispositionException, postClaim } = await import("@/lib/audit/disposition");
const { PATCH } = await import("@/app/api/claims/[claimId]/exceptions/[exceptionId]/route");
const { precisionRows } = await import("@/lib/economics/precision");

const digits = String(Date.now()).slice(-8);
const claimA = `CLM-7${digits.slice(0, 3)}-${digits.slice(3, 7)}`;
const claimB = `CLM-6${digits.slice(0, 3)}-${digits.slice(3, 7)}`;
const exc = (claimId: string, rule: string) => `EXC-${claimId.slice(4)}-${rule}`;
const opts = { requestId: "test-d39", actor: reviewer.name };
const note = "Checked against the supplier statement and the scan.";

async function fixtureClaim(claimId: string, rules: string[]) {
  const vendor = await prisma.vendor.findFirstOrThrow();
  await prisma.claim.create({
    data: {
      claimId, employee: "Disposition Test Submitter", department: "Plant Operations", category: "MRO & Equipment Repair", amount: "1250.00", status: "Analyzed",
      originalReceipt: `/api/receipts/${claimId}/original`, vendorId: vendor.vendorId, vendorName: vendor.name, invoiceNumber: `INV-${claimId.slice(4)}`, source: "test",
      submittedAt: new Date("2026-10-20T12:00:00Z"), analyzedAt: new Date("2026-10-20T13:00:00Z"), riskScore: 15, riskLevel: "Low", decision: "REVIEW",
      exceptions: { create: rules.map((r) => ({ exceptionId: exc(claimId, r), anomalyType: "Test Finding", riskLevel: "Low", ruleId: r, points: 15, message: "Fixture finding", status: "Open" })) },
    },
  });
}

beforeAll(async () => {
  await fixtureClaim(claimA, ["R-10", "R-13", "R-14"]);
  await fixtureClaim(claimB, ["R-14", "R-16"]);
});
afterAll(() => prisma.$disconnect());

describe("dispositions through the service", () => {
  it.each([
    ["R-10", "Resolved", "Exception Resolved"],
    ["R-13", "Waived", "Exception Waived"],
    ["R-14", "Dismissed", "Exception Dismissed"],
  ] as const)("%s → %s writes the status, the reviewer and an '%s' audit row with the disposition", async (rule, status, action) => {
    const res = await dispositionException(claimA, exc(claimA, rule), { status, note }, opts);
    expect(res).toEqual({ exceptionId: exc(claimA, rule), status });
    expect(await prisma.exception.findUniqueOrThrow({ where: { exceptionId: exc(claimA, rule) } })).toMatchObject({ status, resolvedBy: reviewer.name });
    const log = await prisma.auditLog.findFirstOrThrow({ where: { claimId: claimA, action } });
    expect(log.actor).toBe(reviewer.name);
    expect(JSON.parse(log.metadata!)).toMatchObject({ requestId: "test-d39", disposition: status });
    expect(log.details).toContain(note);
  });
});

describe("Dismissed does not block posting", () => {
  it("a claim whose only remaining findings are Dismissed posts to SAP", async () => {
    for (const r of ["R-14", "R-16"]) await dispositionException(claimB, exc(claimB, r), { status: "Dismissed", note }, opts);
    const posted = await postClaim(claimB, opts);
    expect(posted.status).toBe("Posted");
    expect((await prisma.claim.findUniqueOrThrow({ where: { claimId: claimB } })).status).toBe("Posted");
  });
});

describe("PATCH /exceptions/:id", () => {
  const patch = (claimId: string, exceptionId: string, body: unknown) =>
    PATCH(new Request(`http://localhost/api/claims/${claimId}/exceptions/${exceptionId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), {
      params: Promise.resolve({ claimId, exceptionId }),
    });

  it("rejects an unknown disposition with 400 VALIDATION_FAILED", async () => {
    const claimC = `CLM-5${digits.slice(0, 3)}-${digits.slice(3, 7)}`;
    await fixtureClaim(claimC, ["R-14"]);
    const res = await patch(claimC, exc(claimC, "R-14"), { status: "FalseAlarm", note });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("VALIDATION_FAILED");
    expect((await prisma.exception.findUniqueOrThrow({ where: { exceptionId: exc(claimC, "R-14") } })).status).toBe("Open");
  });

  it("still requires the 10–500 character note for a dismissal (it must not be the cheapest click)", async () => {
    const claimD = `CLM-4${digits.slice(0, 3)}-${digits.slice(3, 7)}`;
    await fixtureClaim(claimD, ["R-14"]);
    expect((await patch(claimD, exc(claimD, "R-14"), { status: "Dismissed", note: "too short" })).status).toBe(400);
    const ok = await patch(claimD, exc(claimD, "R-14"), { status: "Dismissed", note });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { status: string }).status).toBe("Dismissed");
  });
});

describe("precision table arithmetic", () => {
  it("counts alerts, dismissed and confirmed per rule; the rate is over decided alerts only", () => {
    const rows = precisionRows([
      { ruleId: "R-14", anomalyType: "Low OCR Confidence", status: "Dismissed", count: 3 },
      { ruleId: "R-14", anomalyType: "Low OCR Confidence", status: "Resolved", count: 1 },
      { ruleId: "R-14", anomalyType: "Low OCR Confidence", status: "Open", count: 2 },
      { ruleId: "R-03", anomalyType: "Duplicate Supplier Invoice", status: "Resolved", count: 2 },
      { ruleId: "R-03", anomalyType: "Duplicate Supplier Invoice", status: "Waived", count: 1 },
      { ruleId: "R-07", anomalyType: "PO Balance Exceeded", status: "Open", count: 4 },
    ]);
    expect(rows).toEqual([
      { ruleId: "R-03", anomalyType: "Duplicate Supplier Invoice", alerts: 3, dismissed: 0, confirmed: 3, open: 0, dismissalRate: 0 },
      { ruleId: "R-07", anomalyType: "PO Balance Exceeded", alerts: 4, dismissed: 0, confirmed: 0, open: 4, dismissalRate: null },
      { ruleId: "R-14", anomalyType: "Low OCR Confidence", alerts: 6, dismissed: 3, confirmed: 1, open: 2, dismissalRate: 0.75 },
    ]);
  });
});
