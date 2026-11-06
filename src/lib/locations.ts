// Sites and spend attribution (Task 12, D-43). Pure: no Prisma, no I/O.
// A claim's site comes from the invoice's ship-to plant when it names one of our sites; travel, entertainment and
// claims not yet extracted have no plant, so they fall back to the submitter's home site, then the department.

export type SiteId = "auburn-hills" | "toledo" | "chattanooga" | "san-antonio" | "laredo" | "unassigned";
export type Site = { id: SiteId; name: string; city: string; state: string };
export type SiteBasis = "ship-to" | "employee" | "unassigned";

export const SITES: Site[] = [
  { id: "auburn-hills", name: "Auburn Hills HQ & R&D Center", city: "Auburn Hills", state: "MI" },
  { id: "toledo", name: "Toledo Seatbelt Plant", city: "Toledo", state: "OH" },
  { id: "chattanooga", name: "Chattanooga Airbag Module Plant", city: "Chattanooga", state: "TN" },
  { id: "san-antonio", name: "San Antonio Electronics Plant", city: "San Antonio", state: "TX" },
  { id: "laredo", name: "Laredo Cross-Dock", city: "Laredo", state: "TX" },
  { id: "unassigned", name: "Unassigned", city: "", state: "" },
];

export const SITE_BY_ID: Record<SiteId, Site> = Object.fromEntries(SITES.map((s) => [s.id, s])) as Record<SiteId, Site>;

/** Lower-case, every dash variant (hyphen, en dash, em dash, minus, ‒ ―) → "-", whitespace collapsed. */
function normalise(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[‐-―−-]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

// Prefixes of the normalised ship-to plant names that occur in the extractions. A prefix (not a substring) so that
// "Supplier Quality — supplier audit trip" or a trip *to* Toledo described in free text never matches a plant.
const SHIP_TO_PREFIX: [string, SiteId][] = [
  ["toledo seatbelt plant", "toledo"],
  ["chattanooga airbag module plant", "chattanooga"],
  ["auburn hills hq", "auburn-hills"],
  ["san antonio electronics plant", "san-antonio"],
  ["laredo cross-dock", "laredo"],
];

/** The site an invoice ship-to plant names, or null when it names none of our sites (travel, events, proving ground). */
export function siteFromShipTo(raw: string | null | undefined): SiteId | null {
  if (!raw) return null;
  const s = normalise(raw);
  return SHIP_TO_PREFIX.find(([prefix]) => s.startsWith(prefix))?.[1] ?? null;
}

/** Home site per employee: explicit demo master data (an HR feed in production). */
export const EMPLOYEE_SITE: Record<string, SiteId> = {
  "Marcus Reed": "auburn-hills",
  "Aisha Bell": "auburn-hills",
  "Priya Natarajan": "toledo",
  "Tyler Brooks": "toledo",
  "Elena Vasquez": "chattanooga",
  "Sofia Marin": "chattanooga",
  "James O'Connor": "laredo",
  // Routing-role owners sit at the site of the department they cover.
  "Grace Whitaker": "auburn-hills", // R&D Engineering
  "Hannah Lindqvist": "chattanooga", // Supplier Quality
  "Omar Haddad": "laredo", // Supply Chain
};

/** Fallback when the employee is unknown. Departments not listed (e.g. Corporate Audit) → unassigned. */
export const DEPARTMENT_SITE: Record<string, SiteId> = {
  "R&D Engineering": "auburn-hills",
  "Plant Operations": "toledo",
  "Supplier Quality": "chattanooga",
  "Supply Chain": "laredo",
};

/** Ship-to first, then the submitter's home site, then the department's, then unassigned. */
export function resolveSite(input: { shipToPlant?: string | null; employee: string; department: string }): { site: SiteId; basis: SiteBasis } {
  const fromShipTo = siteFromShipTo(input.shipToPlant);
  if (fromShipTo) return { site: fromShipTo, basis: "ship-to" };
  const viaPerson = EMPLOYEE_SITE[input.employee] ?? DEPARTMENT_SITE[input.department];
  if (viaPerson) return { site: viaPerson, basis: "employee" };
  return { site: "unassigned", basis: "unassigned" };
}
