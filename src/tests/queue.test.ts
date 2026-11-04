import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { groupQueue, loadQueue, type QueueGroups, type QueueRow } from "@/lib/queue";

// /queue grouping (DECISIONS D-34). Claim ids below are ones no other test file moves between groups:
// 0075 (Priya's, one open R-finding), 0077 (submitted by Priya, role unowned), 0142 (Marcus, clean or Pending),
// 0144 (submitted by Priya), 0148 (Sofia, stays Pending). 0067 / 0088 / 0143 / 0147 are changed by other files.
const reviewer = { name: "Priya Natarajan", role: "reviewer" };
const requester = { name: "Marcus Reed", role: "requester" };
const ids = (g: QueueGroups) => ({ pending: g.pending.map((r) => r.claimId), disposition: g.disposition.map((r) => r.claimId), ready: g.ready.map((r) => r.claimId) });
const all = (g: QueueGroups) => [...g.pending, ...g.disposition, ...g.ready];

afterAll(() => prisma.$disconnect());

describe("groupQueue (pure)", () => {
  const row = (claimId: string, status: string, openExceptions: number, day: number): QueueRow => ({
    claimId, employee: "x", vendorName: "v", amountCents: 100, status, riskLevel: null, riskScore: null, decision: null,
    assignedRole: null, assignedTo: null, openExceptions, submittedAt: new Date(Date.UTC(2026, 9, day)),
  });
  it("Pending → pending audit; Analyzed with open exceptions → disposition; Analyzed with none → ready; Posted dropped; oldest first", () => {
    const g = groupQueue([row("C", "Analyzed", 0, 3), row("A", "Pending", 0, 2), row("B", "Analyzed", 2, 1), row("D", "Posted", 0, 1), row("E", "Pending", 0, 1)]);
    expect(ids(g)).toEqual({ pending: ["E", "A"], disposition: ["B"], ready: ["C"] });
  });
});

describe("loadQueue against the seeded DB", () => {
  it("reviewer: assigned-to-me groups plus an Unassigned section, never their own submissions", async () => {
    const q = await loadQueue(reviewer);
    if (q.mode !== "reviewer") throw new Error("expected reviewer queue");
    expect(ids(q.mine).disposition).toContain("CLM-2026-0075");
    expect(all(q.mine).every((r) => r.assignedTo === reviewer.name)).toBe(true);
    expect(q.mine.pending).toEqual([]); // assignment happens at audit time
    expect(all(q.unassigned).every((r) => r.assignedTo === null && r.employee !== reviewer.name)).toBe(true);
    expect(ids(q.unassigned).pending).toContain("CLM-2026-0148");
    expect([...ids(q.unassigned).pending, ...ids(q.unassigned).ready]).toContain("CLM-2026-0142");
    const everywhere = [...all(q.mine), ...all(q.unassigned)].map((r) => r.claimId);
    expect(everywhere).not.toContain("CLM-2026-0144");
    expect(everywhere).not.toContain("CLM-2026-0077");
    expect(all(q.mine).concat(all(q.unassigned)).every((r) => r.status === "Pending" || r.status === "Analyzed")).toBe(true);
  });

  it("admin sees the unowned Plant Controller claim Priya submitted (CLM-2026-0077) in Unassigned", async () => {
    const q = await loadQueue({ name: "Dana Whitfield", role: "admin" });
    if (q.mode !== "reviewer") throw new Error("expected reviewer queue");
    expect(ids(q.unassigned).disposition).toContain("CLM-2026-0077");
    expect(all(q.mine)).toEqual([]);
  });

  it("requester: only their own submissions, no Unassigned section", async () => {
    const q = await loadQueue(requester);
    expect(q.mode).toBe("requester");
    expect(all(q.mine).length).toBeGreaterThan(0);
    expect(all(q.mine).every((r) => r.employee === requester.name)).toBe(true);
    expect(all(q.mine).map((r) => r.claimId)).toContain("CLM-2026-0142");
    expect("unassigned" in q).toBe(false);
  });
});
