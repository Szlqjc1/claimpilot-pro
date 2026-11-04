import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { runAudit } from "@/lib/audit/run-audit";
import { resolveAssignment } from "@/lib/domain/routing";
import { EMPLOYEES } from "@/lib/seed/master";
import { ROUTING } from "@/lib/domain/constants";

// Escalation routing resolver (DECISIONS D-34): department → role → owner, never the submitter.
const staff = [
  { name: "Priya Natarajan", title: "Plant Controller" },
  { name: "Tyler Brooks", title: "Maintenance Manager" },
];

describe("resolveAssignment", () => {
  it("routes a flagged claim to the role owner", () => {
    expect(resolveAssignment("Plant Operations", 2, staff, "Tyler Brooks")).toEqual({ role: "Plant Controller", owner: "Priya Natarajan", excludedSubmitter: false });
  });

  it("a clean claim (no findings) is not assigned", () => {
    expect(resolveAssignment("Plant Operations", 0, staff, "Tyler Brooks")).toBeNull();
  });

  it("a role with no matching employee has no owner", () => {
    expect(resolveAssignment("Supply Chain", 1, staff, "Tyler Brooks")).toEqual({ role: "Supply Chain Controller", owner: null, excludedSubmitter: false });
  });

  it("never routes to the submitter: role owner submitted the claim → owner null, excludedSubmitter", () => {
    expect(resolveAssignment("Plant Operations", 3, staff, "Priya Natarajan")).toEqual({ role: "Plant Controller", owner: null, excludedSubmitter: true });
  });

  it("an unknown department falls back to Accounts Payable", () => {
    expect(resolveAssignment("Corporate Audit", 1, staff, null)).toEqual({ role: "Accounts Payable", owner: null, excludedSubmitter: false });
  });

  it("the seeded master data has exactly one owner for every routing role", () => {
    for (const role of Object.values(ROUTING)) expect(EMPLOYEES.filter((e) => e.title === role), role).toHaveLength(1);
  });
});

// Invariant (Task 3 review): the queue hides claims whose assignedTo equals their employee, so such a claim
// would vanish from every queue silently. Routing never produces it; this guards hand edits and future features.
describe("no claim is assigned to its own submitter", () => {
  afterAll(() => prisma.$disconnect());
  const selfAssigned = async () =>
    (await prisma.claim.findMany({ select: { claimId: true, employee: true, assignedTo: true } })).filter((r) => r.assignedTo !== null && r.assignedTo === r.employee);

  it("holds for the seeded database", async () => {
    expect(await selfAssigned()).toEqual([]);
  });

  it("still holds after an audit run on a claim whose submitter owns the routing role", async () => {
    // A pending historical claim Priya (the Plant Controller) submitted herself; no other test file touches it.
    const own = await prisma.claim.findFirst({
      where: { status: "Pending", source: "seed", employee: "Priya Natarajan", department: "Plant Operations", NOT: { claimId: { startsWith: "CLM-2026-014" } } },
      orderBy: { claimId: "asc" },
    });
    expect(own, "seed should contain a pending Plant Operations claim submitted by Priya").not.toBeNull();
    await runAudit(own!.claimId, { requestId: "test-invariant", initiatedBy: "Test" });
    const after = await prisma.claim.findUniqueOrThrow({ where: { claimId: own!.claimId } });
    expect(after.status).toBe("Analyzed");
    expect(after.assignedTo).not.toBe("Priya Natarajan");
    expect(await selfAssigned()).toEqual([]);
  });
});
