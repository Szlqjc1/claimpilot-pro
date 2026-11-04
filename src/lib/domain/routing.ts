import { ROUTING, type Department } from "./constants";

// Escalation routing as data (DECISIONS D-34). Pure: no Prisma, so the seed can reuse it in memory.
// department → role (ROUTING, the same table that produces "Routed to …") → owner (Employee with that title).

export type Assignment = { role: string; owner: string | null; excludedSubmitter: boolean };

export function resolveAssignment(
  department: string,
  findingCount: number,
  employees: readonly { name: string; title: string }[],
  submitterName?: string | null,
): Assignment | null {
  if (findingCount === 0) return null;
  const role = ROUTING[department as Department] ?? "Accounts Payable";
  const candidate = employees.find((e) => e.title === role);
  // Never route a claim to its own submitter: segregation of duties (D-27) would stop them acting on it.
  if (candidate && submitterName && candidate.name === submitterName) return { role, owner: null, excludedSubmitter: true };
  return { role, owner: candidate?.name ?? null, excludedSubmitter: false };
}
