import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { groupQueue, loadQueue, type QueueGroups, type QueueRow } from "@/lib/queue";

// /queue grouping (DECISIONS D-34). Self-contained: this file inserts and deletes its own claims
// (ids TST-<tag>-…) and never relies on seeded claim ids, so other test files cannot break it.
const ids = (g: QueueGroups) => ({ pending: g.pending.map((r) => r.claimId), disposition: g.disposition.map((r) => r.claimId), ready: g.ready.map((r) => r.claimId) });

describe("groupQueue (pure)", () => {
  const row = (claimId: string, status: string, openExceptions: number, day: number): QueueRow => ({
    claimId, employee: "x", vendorName: "v", amountCents: 100, status, riskLevel: null, riskScore: null, decision: null,
    assignedRole: null, assignedTo: null, openExceptions, submittedAt: new Date(Date.UTC(2026, 9, day)), extractionSource: null,
  });
  it("Pending → pending audit; Analyzed with open exceptions → disposition; Analyzed with none → ready; Posted dropped; oldest first", () => {
    const g = groupQueue([row("C", "Analyzed", 0, 3), row("A", "Pending", 0, 2), row("B", "Analyzed", 2, 1), row("D", "Posted", 0, 1), row("E", "Pending", 0, 1)]);
    expect(ids(g)).toEqual({ pending: ["E", "A"], disposition: ["B"], ready: ["C"] });
  });
});

describe("loadQueue (own fixture)", () => {
  const tag = randomUUID().slice(0, 8);
  const prefix = `TST-${tag}-`;
  const reviewer = { name: `Queue Test Reviewer ${tag}`, role: "reviewer" };
  const submitter = { name: `Queue Test Submitter ${tag}`, role: "requester" };
  const id = (n: string) => `${prefix}${n}`;
  const mine = (g: QueueGroups) => {
    const f = (rows: QueueRow[]) => rows.map((r) => r.claimId).filter((c) => c.startsWith(prefix));
    return { pending: f(g.pending), disposition: f(g.disposition), ready: f(g.ready) };
  };

  type Spec = { n: string; status: string; employee: string; assignedTo: string | null; day: number; exceptions?: ("Open" | "Resolved")[]; extractionSource?: string };
  const fixture: Spec[] = [
    { n: "01", status: "Pending", employee: submitter.name, assignedTo: reviewer.name, day: 1 }, //                assigned → pending
    { n: "02", status: "Analyzed", employee: submitter.name, assignedTo: reviewer.name, day: 2, exceptions: ["Open", "Resolved"], extractionSource: "model" }, // → disposition
    { n: "03", status: "Analyzed", employee: submitter.name, assignedTo: reviewer.name, day: 3, exceptions: ["Resolved"] }, //        → ready
    { n: "04", status: "Analyzed", employee: submitter.name, assignedTo: null, day: 4, exceptions: ["Open"] }, //                     unassigned → disposition
    { n: "05", status: "Pending", employee: submitter.name, assignedTo: null, day: 5 }, //                                            unassigned → pending
    { n: "06", status: "Analyzed", employee: reviewer.name, assignedTo: reviewer.name, day: 6, exceptions: ["Open"] }, //             own submission: hidden
    { n: "07", status: "Pending", employee: reviewer.name, assignedTo: null, day: 7 }, //                                             own submission: hidden
    { n: "08", status: "Posted", employee: submitter.name, assignedTo: reviewer.name, day: 8 }, //                                    posted: hidden
  ];

  beforeAll(async () => {
    for (const c of fixture) {
      await prisma.claim.create({
        data: {
          claimId: id(c.n),
          employee: c.employee,
          department: "Plant Operations",
          category: "MRO & Equipment Repair",
          amount: "100.00",
          status: c.status,
          originalReceipt: `/api/receipts/${id(c.n)}/original`,
          vendorName: "Queue Test Vendor",
          source: "test",
          submittedAt: new Date(Date.UTC(2026, 9, c.day)),
          assignedRole: c.assignedTo ? "Plant Controller" : null,
          assignedTo: c.assignedTo,
          extractionSource: c.extractionSource ?? null,
          exceptions: {
            create: (c.exceptions ?? []).map((status, i) => ({
              exceptionId: `EXC-${tag}-${c.n}-${i}`,
              anomalyType: "Test Finding",
              riskLevel: "Low",
              ruleId: `R-0${i + 1}`,
              points: 5,
              message: "Fixture exception",
              status,
            })),
          },
        },
      });
    }
  });
  afterAll(async () => {
    await prisma.claim.deleteMany({ where: { claimId: { startsWith: prefix } } }); // exceptions cascade
    await prisma.$disconnect();
  });

  it("reviewer: 'Assigned to you' holds exactly their assigned claims, by stage, never their own", async () => {
    const q = await loadQueue(reviewer);
    if (q.mode !== "reviewer") throw new Error("expected reviewer queue");
    // Nothing outside the fixture is assigned to this synthetic name, so this is exact without filtering.
    expect(ids(q.mine)).toEqual({ pending: [id("01")], disposition: [id("02")], ready: [id("03")] });
  });

  it("reviewer: Unassigned shows other people's unowned claims by stage, not their own submissions", async () => {
    const q = await loadQueue(reviewer);
    if (q.mode !== "reviewer") throw new Error("expected reviewer queue");
    // Seeded unassigned claims also appear here; look only at this file's fixture.
    expect(mine(q.unassigned)).toEqual({ pending: [id("05")], disposition: [id("04")], ready: [] });
  });

  it("own submissions and posted claims never appear for the reviewer", async () => {
    const q = await loadQueue(reviewer);
    if (q.mode !== "reviewer") throw new Error("expected reviewer queue");
    const shown = [...Object.values(ids(q.mine)), ...Object.values(ids(q.unassigned))].flat();
    for (const hidden of ["06", "07", "08"]) expect(shown).not.toContain(id(hidden));
  });

  it("requester: only their own submissions, by stage, posted excluded, no Unassigned section", async () => {
    const q = await loadQueue(submitter);
    expect(q.mode).toBe("requester");
    expect("unassigned" in q).toBe(false);
    expect(ids(q.mine)).toEqual({ pending: [id("01"), id("05")], disposition: [id("02"), id("04")], ready: [id("03")] });
  });

  it("queue rows carry the claim's extraction provenance from the claim row (no per-row AiRun lookup)", async () => {
    const q = await loadQueue(reviewer);
    if (q.mode !== "reviewer") throw new Error("expected reviewer queue");
    expect(q.mine.disposition.find((r) => r.claimId === id("02"))?.extractionSource).toBe("model");
    expect(q.mine.ready.find((r) => r.claimId === id("03"))?.extractionSource).toBeNull();
  });
});
