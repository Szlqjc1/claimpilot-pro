import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { toCents } from "@/lib/domain/money";
import { DEPARTMENT_SITE, EMPLOYEE_SITE, resolveSite, SITES, siteFromShipTo } from "@/lib/locations";
import { computeSiteSpend, shipToPlantOf, siteSpend } from "@/lib/kpi/locations";

// Spend by site (Task 12, D-43). Pure except the last block, which reads the seeded test DB.

afterAll(() => prisma.$disconnect());

describe("siteFromShipTo", () => {
  it.each([
    ["Toledo Seatbelt Plant — Line B", "toledo"],
    ["Toledo Seatbelt Plant – Line B", "toledo"],
    ["Toledo Seatbelt Plant - Line B", "toledo"],
    ["TOLEDO SEATBELT PLANT —  LINE B", "toledo"],
    ["Chattanooga Airbag Module Plant", "chattanooga"],
    ["Auburn Hills HQ & R&D Center", "auburn-hills"],
    ["San Antonio Electronics Plant", "san-antonio"],
    ["Laredo Cross-Dock (Monterrey supply)", "laredo"],
    ["Laredo Cross–Dock (Monterrey supply)", "laredo"],
    ["Laredo Cross—Dock (Monterrey supply)", "laredo"],
  ] as const)("%j → %s", (raw, site) => {
    expect(siteFromShipTo(raw)).toBe(site);
  });

  it.each(["Supplier Quality — supplier audit trip", "Midwest Proving Grounds — Track 3", "Private dining — OEM program review", "Toledo, OH", "", null, undefined])(
    "%j → null",
    (raw) => {
      expect(siteFromShipTo(raw)).toBeNull();
    },
  );
});

describe("resolveSite", () => {
  it("prefers the ship-to plant over the submitter", () => {
    expect(resolveSite({ shipToPlant: "San Antonio Electronics Plant", employee: "Priya Natarajan", department: "Plant Operations" })).toEqual({ site: "san-antonio", basis: "ship-to" });
  });

  it("falls back to the employee's home site", () => {
    expect(resolveSite({ shipToPlant: null, employee: "Elena Vasquez", department: "R&D Engineering" })).toEqual({ site: "chattanooga", basis: "employee" });
  });

  it("then the department, then unassigned", () => {
    expect(resolveSite({ shipToPlant: null, employee: "Someone New", department: "Supply Chain" })).toEqual({ site: "laredo", basis: "employee" });
    expect(resolveSite({ shipToPlant: "Midwest Proving Grounds — Track 3", employee: "Dana Whitfield", department: "Corporate Audit" })).toEqual({ site: "unassigned", basis: "unassigned" });
  });

  it("a private dinner submitted by Priya resolves to Toledo, through the employee", () => {
    expect(resolveSite({ shipToPlant: "Private dining — OEM program review", employee: "Priya Natarajan", department: "Plant Operations" })).toEqual({ site: "toledo", basis: "employee" });
  });

  it("master data only names real sites", () => {
    const ids = new Set(SITES.map((s) => s.id));
    for (const id of [...Object.values(EMPLOYEE_SITE), ...Object.values(DEPARTMENT_SITE)]) expect(ids.has(id)).toBe(true);
    expect(SITES.map((s) => s.id)).toEqual(["auburn-hills", "toledo", "chattanooga", "san-antonio", "laredo", "unassigned"]);
  });
});

describe("computeSiteSpend", () => {
  const rows = computeSiteSpend([
    { employee: "Tyler Brooks", department: "Plant Operations", category: "Tooling & Dies", amountCents: 50_000, shipToPlant: "Toledo Seatbelt Plant — Line B" },
    { employee: "Priya Natarajan", department: "Plant Operations", category: "Client Entertainment", amountCents: 20_000, shipToPlant: "Private dining — OEM program review" },
    { employee: "Elena Vasquez", department: "Supplier Quality", category: "Direct Parts Procurement", amountCents: 80_000, shipToPlant: "Chattanooga Airbag Module Plant" },
    { employee: "Dana Whitfield", department: "Corporate Audit", category: "Supplier Audit Travel", amountCents: 10_000, shipToPlant: null },
  ]);

  it("returns every site, by spend, unassigned last", () => {
    expect(rows.map((r) => r.site.id)).toEqual(["chattanooga", "toledo", "auburn-hills", "san-antonio", "laredo", "unassigned"]);
    expect(rows.find((r) => r.site.id === "unassigned")).toMatchObject({ claims: 1, spendCents: 10_000 });
  });

  it("splits ship-to spend from spend attributed through a person", () => {
    expect(rows.find((r) => r.site.id === "toledo")).toMatchObject({ claims: 2, spendCents: 70_000, travelClaims: 1, travelCents: 20_000, topCategory: "Tooling & Dies" });
    expect(rows.find((r) => r.site.id === "chattanooga")).toMatchObject({ travelClaims: 0, travelCents: 0 });
    expect(rows.find((r) => r.site.id === "laredo")).toMatchObject({ claims: 0, share: 0, topCategory: null });
  });

  it("is empty-safe", () => {
    expect(computeSiteSpend([]).every((r) => r.share === 0 && r.spendCents === 0)).toBe(true);
  });
});

describe("siteSpend over the seeded claims", () => {
  it("shares sum to 1 and spend sums to every claim's amount", async () => {
    const [rows, claims] = await Promise.all([siteSpend(), prisma.claim.findMany({ select: { amount: true } })]);
    expect(rows.reduce((s, r) => s + r.share, 0)).toBeCloseTo(1, 9);
    expect(rows.reduce((s, r) => s + r.spendCents, 0)).toBe(claims.reduce((s, c) => s + toCents(c.amount), 0));
    expect(rows.reduce((s, r) => s + r.claims, 0)).toBe(claims.length);
  });

  it("travel spend is non-zero only where claims were attributed through a person", async () => {
    const claims = await prisma.claim.findMany({ select: { employee: true, department: true, amount: true, extractedData: true } });
    const viaPerson = new Map<string, number>();
    for (const c of claims) {
      const r = resolveSite({ shipToPlant: shipToPlantOf(c.extractedData), employee: c.employee, department: c.department });
      if (r.basis !== "ship-to") viaPerson.set(r.site, (viaPerson.get(r.site) ?? 0) + toCents(c.amount));
    }
    for (const row of await siteSpend()) {
      expect(row.travelCents).toBe(viaPerson.get(row.site.id) ?? 0);
      expect(row.travelCents > 0).toBe(viaPerson.has(row.site.id));
      expect(row.travelCents).toBeLessThanOrEqual(row.spendCents);
    }
  });
});
