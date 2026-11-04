import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { toCents } from "@/lib/domain/money";
import { canReview } from "@/lib/auth/session";

// Work queue (DECISIONS D-34). Routing is data on the claim (assignedRole / assignedTo); this only reads it.

export type QueueStage = "pending" | "disposition" | "ready";
export const QUEUE_STAGES: { stage: QueueStage; title: string; empty: string }[] = [
  { stage: "pending", title: "Pending audit", empty: "No claims waiting for the AI-RPA audit." },
  { stage: "disposition", title: "Needs disposition", empty: "No claims with open exceptions." },
  { stage: "ready", title: "Ready to post", empty: "No claims ready to post to SAP." },
];

export type QueueRow = {
  claimId: string;
  employee: string;
  vendorName: string;
  amountCents: number;
  status: string;
  riskLevel: string | null;
  riskScore: number | null;
  decision: string | null;
  assignedRole: string | null;
  assignedTo: string | null;
  openExceptions: number;
  submittedAt: Date;
};
export type QueueGroups = Record<QueueStage, QueueRow[]>;
export type Queue = { mode: "reviewer"; mine: QueueGroups; unassigned: QueueGroups } | { mode: "requester"; mine: QueueGroups };

export function stageOf(row: Pick<QueueRow, "status" | "openExceptions">): QueueStage | null {
  if (row.status === "Pending") return "pending";
  if (row.status === "Analyzed") return row.openExceptions > 0 ? "disposition" : "ready";
  return null; // Posted is done, not work.
}

/** Pure: split rows into the three stages, oldest submission first. */
export function groupQueue(rows: QueueRow[]): QueueGroups {
  const groups: QueueGroups = { pending: [], disposition: [], ready: [] };
  for (const r of [...rows].sort((a, b) => a.submittedAt.getTime() - b.submittedAt.getTime())) {
    const stage = stageOf(r);
    if (stage) groups[stage].push(r);
  }
  return groups;
}

async function loadRows(where: Prisma.ClaimWhereInput): Promise<QueueRow[]> {
  const claims = await prisma.claim.findMany({
    where: { AND: [{ status: { in: ["Pending", "Analyzed"] } }, where] },
    select: {
      claimId: true,
      employee: true,
      vendorName: true,
      amount: true,
      status: true,
      riskLevel: true,
      riskScore: true,
      decision: true,
      assignedRole: true,
      assignedTo: true,
      submittedAt: true,
      _count: { select: { exceptions: { where: { status: "Open" } } } },
    },
  });
  return claims.map(({ amount, _count, ...c }) => ({ ...c, amountCents: toCents(amount), openExceptions: _count.exceptions }));
}

/**
 * Reviewer/admin: claims assigned to them, plus an Unassigned section (assignedTo null) so somebody picks
 * those up. Their own submissions are left out of Unassigned, because D-27 forbids them acting on those.
 * Requester: only their own submissions, read-only.
 */
export async function loadQueue(user: { name: string; role: string }): Promise<Queue> {
  if (!canReview(user)) return { mode: "requester", mine: groupQueue(await loadRows({ employee: user.name })) };
  const [mine, unassigned] = await Promise.all([loadRows({ assignedTo: user.name }), loadRows({ assignedTo: null, employee: { not: user.name } })]);
  return { mode: "reviewer", mine: groupQueue(mine), unassigned: groupQueue(unassigned) };
}
