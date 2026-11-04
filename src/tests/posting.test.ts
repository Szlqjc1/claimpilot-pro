import { afterAll, describe, expect, it, vi } from "vitest";

// The PATCH route checks the session; give it a signed-in reviewer instead of removing the check.
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  requireUser: async () => ({ id: "U-TEST", name: "Test Reviewer", email: "reviewer@test.example", role: "reviewer" }),
}));
import { prisma } from "@/lib/db";
import { runAudit } from "@/lib/audit/run-audit";
import { dispositionException, postClaim } from "@/lib/audit/disposition";
import { PATCH } from "@/app/api/claims/[claimId]/exceptions/[exceptionId]/route";

// Uses CLM-2026-0143 / 0148, which audit.test.ts does not touch.
const opts = { requestId: "test", actor: "Test Reviewer" };
const CLAIM = "CLM-2026-0143";
const EXC = "EXC-2026-0143-R-11";

const patch = (claimId: string, exceptionId: string, body: unknown) =>
  PATCH(
    new Request(`http://localhost/api/claims/${claimId}/exceptions/${exceptionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ claimId, exceptionId }) },
  );

afterAll(() => prisma.$disconnect());

describe("disposition and posting (integration)", () => {
  it("posting a claim that was never analyzed → 409", async () => {
    await expect(postClaim("CLM-2026-0148", opts)).rejects.toMatchObject({ status: 409, code: "CLAIM_NOT_ANALYZED" });
    expect((await prisma.claim.findUniqueOrThrow({ where: { claimId: "CLM-2026-0148" } })).status).toBe("Pending");
  });

  it("posting with an open exception → 409 EXCEPTIONS_OPEN", async () => {
    const audit = await runAudit(CLAIM, opts);
    expect(audit.exceptions.map((e) => e.exceptionId)).toEqual([EXC]);
    await expect(postClaim(CLAIM, opts)).rejects.toMatchObject({ status: 409, code: "EXCEPTIONS_OPEN", message: expect.stringContaining("1 exception") });
    expect((await prisma.claim.findUniqueOrThrow({ where: { claimId: CLAIM } })).status).toBe("Analyzed");
  });

  it("rejects a resolution note shorter than 10 characters → 400", async () => {
    const res = await patch(CLAIM, EXC, { status: "Waived", note: "too short" });
    expect(res.status).toBe(400);
    expect(res.headers.get("x-request-id")).toBeTruthy();
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("VALIDATION_FAILED");
  });

  it("waiving the exception, then posting → Posted with audit trail", async () => {
    const waived = await dispositionException(CLAIM, EXC, { status: "Waived", note: "Lodging rate approved by SQ manager — city-wide event pricing." }, opts);
    expect(waived).toEqual({ exceptionId: EXC, status: "Waived" });

    const posted = await postClaim(CLAIM, opts);
    expect(posted.status).toBe("Posted");
    expect(posted.miroDocNo).toMatch(/^MIRO-\d{8}-[0-9A-F]{6}$/);

    const claim = await prisma.claim.findUniqueOrThrow({ where: { claimId: CLAIM } });
    expect(claim.status).toBe("Posted");
    expect(claim.postedAt).not.toBeNull();
    expect(claim.miroDocNo).toBe(posted.miroDocNo);

    const logs = await prisma.auditLog.findMany({ where: { claimId: CLAIM }, orderBy: { timestamp: "asc" } });
    const actions = logs.map((l) => `${l.actor} / ${l.action}`);
    expect(actions).toContain("Test Reviewer / Exception Waived");
    expect(actions).toContain("Test Reviewer / Exceptions Resolved");
    expect(actions).toContain("SAP S/4HANA Integration / Posted to SAP");
    const postLog = logs.find((l) => l.action === "Posted to SAP")!;
    expect(postLog.details).toBe("Invoice NTM-44719 posted (MIRO) for $3,240.00; payment run Net 60.");
    expect(logs.find((l) => l.action === "Exception Waived")!.details).toMatch(/^R-11 Travel Policy Violation waived — Lodging rate approved/);

    await expect(postClaim(CLAIM, opts)).rejects.toMatchObject({ status: 409, code: "CLAIM_ALREADY_POSTED" });
  });

  it("PATCHing an already-handled exception → 409", async () => {
    // Use a historical Analyzed claim whose exception is still Open, handle it once, then retry.
    const open = await prisma.exception.findFirstOrThrow({ where: { status: "Open", claim: { status: "Analyzed", source: "seed", NOT: { claimId: { startsWith: "CLM-2026-014" } } } } });
    // First disposition goes through the service (revalidatePath needs a Next request context); the retry goes through the route.
    const first = await dispositionException(open.claimId, open.exceptionId, { status: "Resolved", note: "Supplier credit memo received and matched." }, opts);
    expect(first.status).toBe("Resolved");
    const second = await patch(open.claimId, open.exceptionId, { status: "Waived", note: "Second attempt should be rejected." });
    expect(second.status).toBe(409);
    expect(((await second.json()) as { error: { code: string } }).error.code).toBe("EXCEPTION_ALREADY_HANDLED");
  });
});
