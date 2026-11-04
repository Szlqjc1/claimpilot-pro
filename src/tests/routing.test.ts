import { describe, expect, it } from "vitest";
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
