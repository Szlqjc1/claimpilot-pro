import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import type { SessionUser } from "@/lib/auth/session";

// Route handlers read the session through requireUser(); swap the signed-in user per test.
let current: SessionUser | null = null;
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  requireUser: async () => current,
}));
// revalidatePath needs a Next request context; it is not under test here.
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { POST: post } = await import("@/app/api/claims/[claimId]/post/route");
const { PATCH: patch } = await import("@/app/api/claims/[claimId]/exceptions/[exceptionId]/route");
const { POST: submit } = await import("@/app/api/claims/route");

const requester: SessionUser = { id: "U-0003", name: "Marcus Reed", email: "marcus.reed@ironwood.example", role: "requester" };
const reviewer: SessionUser = { id: "U-0002", name: "Priya Natarajan", email: "priya.natarajan@ironwood.example", role: "reviewer" };
const admin: SessionUser = { id: "U-0001", name: "Dana Whitfield", email: "dana.whitfield@ironwood.example", role: "admin" };

const postReq = (claimId: string) => post(new Request(`http://localhost/api/claims/${claimId}/post`, { method: "POST" }), { params: Promise.resolve({ claimId }) });
const patchReq = (claimId: string, exceptionId: string, body = { status: "Resolved", note: "Supplier credit memo matched to invoice." }) =>
  patch(new Request(`http://localhost/api/claims/${claimId}/exceptions/${exceptionId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), {
    params: Promise.resolve({ claimId, exceptionId }),
  });
const code = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;

// An Analyzed historical claim, not submitted by the reviewer, with exactly one open exception.
// Ordered descending so it never collides with posting.test.ts (which takes the first ascending).
let target: { claimId: string; exceptionId: string };

beforeAll(async () => {
  const claim = await prisma.claim.findFirstOrThrow({
    where: { status: "Analyzed", source: "seed", employee: { not: reviewer.name }, exceptions: { some: { status: "Open" } }, NOT: { claimId: { startsWith: "CLM-2026-014" } } },
    include: { exceptions: { where: { status: "Open" } } },
    orderBy: { claimId: "desc" },
  });
  target = { claimId: claim.claimId, exceptionId: claim.exceptions[0].exceptionId };
  // Leave exactly one open exception so posting depends only on the one resolved below.
  await prisma.exception.updateMany({ where: { claimId: claim.claimId, status: "Open", NOT: { exceptionId: target.exceptionId } }, data: { status: "Waived" } });
});
afterAll(() => prisma.$disconnect());

describe("role enforcement (segregation of duties)", () => {
  it("a requester cannot post to SAP → 403", async () => {
    current = requester;
    const res = await postReq(target.claimId);
    expect(res.status).toBe(403);
    expect(await code(res)).toBe("FORBIDDEN");
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });

  it("a requester cannot resolve or waive exceptions → 403", async () => {
    current = requester;
    const res = await patchReq(target.claimId, target.exceptionId);
    expect(res.status).toBe(403);
    expect((await prisma.exception.findUniqueOrThrow({ where: { exceptionId: target.exceptionId } })).status).toBe("Open");
  });

  it("a reviewer resolves an exception; the reviewer is the actor", async () => {
    current = reviewer;
    const res = await patchReq(target.claimId, target.exceptionId);
    expect(res.status).toBe(200);
    const ex = await prisma.exception.findUniqueOrThrow({ where: { exceptionId: target.exceptionId } });
    expect(ex).toMatchObject({ status: "Resolved", resolvedBy: reviewer.name });
    const log = await prisma.auditLog.findFirstOrThrow({ where: { claimId: target.claimId, action: "Exception Resolved" } });
    expect(log.actor).toBe(reviewer.name);
  });

  it("a reviewer posts the claim; summary row by the reviewer, SAP row records initiatedBy", async () => {
    current = reviewer;
    const res = await postReq(target.claimId);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe("Posted");
    const resolved = await prisma.auditLog.findFirstOrThrow({ where: { claimId: target.claimId, action: "Exceptions Cleared Before Posting" } });
    expect(resolved.actor).toBe(reviewer.name);
    const sap = await prisma.auditLog.findFirstOrThrow({ where: { claimId: target.claimId, action: "Posted to SAP" } });
    expect(sap.actor).toBe("SAP S/4HANA Integration");
    expect(JSON.parse(sap.metadata!)).toMatchObject({ initiatedBy: reviewer.name });
  });

  it("a reviewer cannot post or resolve on a claim they submitted themselves → 403", async () => {
    current = reviewer;
    const own = await prisma.claim.findFirstOrThrow({ where: { employee: reviewer.name } });
    const resPost = await postReq(own.claimId);
    expect(resPost.status).toBe(403);
    expect(await code(resPost)).toBe("FORBIDDEN");
    const resPatch = await patchReq(own.claimId, `EXC-${own.claimId.slice(4)}-R-01`);
    expect(resPatch.status).toBe(403);
    expect((await prisma.claim.findUniqueOrThrow({ where: { claimId: own.claimId } })).status).toBe(own.status);
  });
});

describe("claim ownership on submission", () => {
  const form = (extra: Record<string, string> = {}) => {
    const fd = new FormData();
    const fields = { category: "Prototype Material", amount: "1250.00", vendorName: "ProtoWorks Additive Manufacturing", ...extra };
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    fd.set("receipt", new File([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])], "receipt.png", { type: "image/png" }));
    return new Request("http://localhost/api/claims", { method: "POST", body: fd });
  };

  it("the claimant comes from the session; a forged employee field is ignored", async () => {
    current = requester;
    const res = await submit(form({ employee: "Dana Whitfield", department: "Plant Operations" }));
    expect(res.status).toBe(201);
    const { claimId } = (await res.json()) as { claimId: string };
    const claim = await prisma.claim.findUniqueOrThrow({ where: { claimId } });
    expect(claim).toMatchObject({ employee: "Marcus Reed", department: "R&D Engineering", status: "Pending", source: "upload" });
    const log = await prisma.auditLog.findFirstOrThrow({ where: { claimId, action: "Claim Submitted" } });
    expect(log.actor).toBe("Marcus Reed");
  });

  it("a user with no employee record cannot submit → 403", async () => {
    current = { id: "U-9999", name: "Contractor Without Record", email: "contractor@ironwood.example", role: "requester" };
    const res = await submit(form());
    expect(res.status).toBe(403);
    expect(await code(res)).toBe("FORBIDDEN");
  });

  it("an admin whose department is not a claim department cannot submit → 403", async () => {
    current = admin;
    const res = await submit(form());
    expect(res.status).toBe(403);
  });
});
