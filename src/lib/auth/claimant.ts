import "server-only";
import { prisma } from "@/lib/db";
import { DEPARTMENTS, type Department } from "@/lib/domain/constants";

export type Claimant = { ok: true; employee: string; department: Department } | { ok: false; reason: string };

/**
 * The claim owner is always the signed-in user, resolved through the Employee master.
 * Users without an employee record, or whose department is not an expense-claim department
 * (e.g. Corporate Audit), cannot submit claims.
 */
export async function resolveClaimant(userName: string): Promise<Claimant> {
  const row = await prisma.employee.findUnique({ where: { name: userName } });
  if (!row) return { ok: false, reason: "Your account has no employee record, so it cannot submit expense claims." };
  if (!(DEPARTMENTS as readonly string[]).includes(row.department)) {
    return { ok: false, reason: `${row.department} is not an expense-claim department, so this account cannot submit claims.` };
  }
  return { ok: true, employee: row.name, department: row.department as Department };
}
