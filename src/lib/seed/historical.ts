import type { Category, ClaimStatus, Department } from "@/lib/domain/constants";
import { requiredApprovalLevel, APPROVAL_LEVELS } from "@/lib/domain/constants";
import { addDays, isWeekend, toIsoDate } from "@/lib/domain/dates";
import { totalCents, type InvoiceLine } from "@/lib/receipts/invoice";
import { APPROVERS, EMPLOYEES, PLANTS, policyFor, vendorByName, type GrnSeed, type PoSeed } from "./master";
import { DUPLICATE_ORIGINAL, HERO_CLAIMS } from "./heroes";
import { makeDoc, type ClaimSeed } from "./types";

// Deterministic generator for ~120 historical claims (2025-11-01 → 2026-10-25).
// Every claim is built from an InvoiceDoc; anomalies are injected by editing that doc,
// and the risk engine (not this file) decides what is actually flagged.

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;
const int = (r: Rng, min: number, max: number) => Math.floor(r() * (max - min + 1)) + min;
const pick = <T,>(r: Rng, arr: readonly T[]): T => arr[Math.floor(r() * arr.length)];
const roundTo = (cents: number, step: number) => Math.round(cents / step) * step;

type Item = { code: string | null; desc: string; unit: string; price: number; qty: [number, number]; bench?: boolean };

const ITEMS = {
  slaGen: { code: "SLA-BRKT-GEN", desc: "SLA prototype bracket — stamped bracket surrogate", unit: "ea", price: 28_500, qty: [10, 40], bench: true },
  cncGen: { code: "CNC-FIX-GEN", desc: "CNC check fixture — welded assembly", unit: "ea", price: 64_000, qty: [2, 8], bench: true },
  web: { code: "PROTO-WEB-48", desc: "Prototype seatbelt webbing, 48 mm dyed", unit: "m", price: 640, qty: [200, 900], bench: true },
  sls: { code: "SLS-INFL-HSG", desc: "SLS nylon inflator housing prototype", unit: "ea", price: 21_000, qty: [10, 30] },
  engHr: { code: "SVC-ENG-HR", desc: "Engineering support — DFM review", unit: "hr", price: 15_000, qty: [2, 12], bench: true },
  pgDay: { code: "SVC-PG-DAY", desc: "Proving ground track day — durability support", unit: "day", price: 725_000, qty: [1, 1], bench: true },
  sled: { code: "SVC-SLED-RUN", desc: "Crash-sled run — pretensioner validation", unit: "run", price: 185_000, qty: [1, 4], bench: true },
  atd: { code: "SVC-ATD-CAL", desc: "Crash-test dummy calibration — Hybrid III 50th", unit: "ea", price: 240_000, qty: [1, 1], bench: true },
  daq: { code: "DATA-ACQ-PKG", desc: "High-speed video & data acquisition package", unit: "ea", price: 95_000, qty: [1, 1] },
  ltl: { code: "FRT-LTL", desc: "LTL shipment — Midwest lane", unit: "shipment", price: 92_000, qty: [2, 9], bench: true },
  hotshot: { code: "FRT-HOTSHOT", desc: "Hotshot premium freight — line-down recovery", unit: "load", price: 165_000, qty: [1, 2], bench: true },
  customs: { code: "FRT-CUSTOMS", desc: "Customs brokerage — Laredo crossing, Monterrey supply", unit: "entry", price: 38_500, qty: [1, 3] },
  detention: { code: "FRT-DET", desc: "Driver detention at receiving dock", unit: "ea", price: 32_000, qty: [1, 1] },
  dinner: { code: "EVT-DINNER", desc: "OEM program dinner — set menu", unit: "guest", price: 9_500, qty: [4, 10] },
  bracket: { code: "BRKT-STMP-ANCHOR", desc: "Stamped seatbelt anchor bracket, HSLA", unit: "ea", price: 285, qty: [10_000, 20_000], bench: true },
  tray: { code: "BTRAY-EXTR-6061", desc: "Battery tray extrusion 6061-T6, machined", unit: "ea", price: 6_450, qty: [400, 900], bench: true },
  inflHsg: { code: "INFL-HSG-STMP", desc: "Stamped inflator housing, driver module", unit: "ea", price: 1_175, qty: [3_000, 6_000], bench: true },
  bolt: { code: "FAST-M10-109", desc: "Flange bolt M10x1.5 Class 10.9, Zn-Ni", unit: "ea", price: 42, qty: [40_000, 90_000], bench: true },
  conn: { code: "CONN-HARN-12P", desc: "Wiring-harness connector, 12-pin sealed", unit: "ea", price: 185, qty: [10_000, 24_000], bench: true },
  clip: { code: "PRET-RETR-CLIP", desc: "Pretensioner retractor clip", unit: "ea", price: 96, qty: [15_000, 40_000], bench: true },
  dieInsert: { code: "DIE-INSERT-PG", desc: "Progressive die insert — stamped bracket line", unit: "ea", price: 1_850_000, qty: [2, 5], bench: true },
  dieLabor: { code: "SVC-DIE-REFURB", desc: "Die refurbishment labor", unit: "hr", price: 12_500, qty: [120, 400], bench: true },
  screw: { code: "TOOL-INJ-SCREW", desc: "Injection-molding screw & barrel rebuild", unit: "ea", price: 1_480_000, qty: [1, 1], bench: true },
  tryout: { code: "DIE-TRYOUT", desc: "Die tryout & PPAP sample run", unit: "lot", price: 480_000, qty: [1, 1] },
  belt: { code: "CONV-BELT-LB", desc: "Conveyor belt replacement — accumulation zone", unit: "ea", price: 340_000, qty: [1, 3] },
  millwright: { code: "SVC-MAINT-HR", desc: "Millwright maintenance labor", unit: "hr", price: 9_500, qty: [16, 120], bench: true },
  oil: { code: "HYD-OIL-46", desc: "Press hydraulic oil ISO VG 46, 55-gal drum", unit: "drum", price: 69_000, qty: [2, 10], bench: true },
  robotPm: { code: "ROBOT-PM-6AX", desc: "Robot preventive maintenance, 6-axis cell", unit: "ea", price: 420_000, qty: [2, 5], bench: true },
  integ: { code: "SVC-INTEG-HR", desc: "Integration & commissioning labor", unit: "hr", price: 18_500, qty: [8, 60], bench: true },
  forkBatt: { code: "FORK-BATT-48V", desc: "Forklift battery 48V 750Ah", unit: "ea", price: 690_000, qty: [2, 4], bench: true },
  abrasive: { code: "MRO-ABR-KIT", desc: "Abrasives & cutting consumables kit", unit: "kit", price: 42_000, qty: [2, 10] },
  cmm: { code: "CMM-CAL", desc: "CMM calibration with ISO 17025 certificate", unit: "ea", price: 385_000, qty: [2, 4], bench: true },
  gage: { code: "GAGE-RR", desc: "Gage R&R study — PPAP submission", unit: "ea", price: 120_000, qty: [1, 4] },
  cae: { code: "CAE-SEAT-LIC", desc: "CAE seat license — annual subscription", unit: "seat", price: 420_000, qty: [2, 6], bench: true },
  fea: { code: "SVC-FEA-HR", desc: "Crash simulation engineering (FEA)", unit: "hr", price: 16_500, qty: [60, 180], bench: true },
  ppap: { code: "PPAP-LAB", desc: "PPAP lab testing — material certification", unit: "ea", price: 280_000, qty: [1, 4], bench: true },
  sort: { code: "CONT-SORT-HR", desc: "CS1 containment sorting — suspect pretensioners", unit: "hr", price: 4_800, qty: [60, 380], bench: true },
  inspect: { code: "CONT-INSP", desc: "Third-party inspection & certification", unit: "ea", price: 95_000, qty: [1, 4] },
  shuttle: { code: "CONT-SHUTTLE", desc: "Shuttle to Lakeshore Motors assembly plant", unit: "trip", price: 38_500, qty: [1, 6] },
} satisfies Record<string, Item>;

function line(r: Rng, item: Item): InvoiceLine {
  // Benchmarked items stay within -5%..+8% of p50 so clean claims never trip R-08.
  const jitter = item.bench ? 1 + (r() * 0.13 - 0.05) : 1 + (r() * 0.2 - 0.1);
  return {
    partNumber: item.code,
    description: item.desc,
    quantity: int(r, item.qty[0], item.qty[1]),
    unit: item.unit,
    unitPriceCents: Math.max(1, Math.round(item.price * jitter)),
  };
}

function pickLines(r: Rng, items: Item[], min: number, max: number): InvoiceLine[] {
  const pool = [...items];
  const n = Math.min(pool.length, int(r, min, max));
  const out: InvoiceLine[] = [];
  for (let i = 0; i < n; i++) out.push(line(r, pool.splice(Math.floor(r() * pool.length), 1)[0]));
  return out;
}

type Built = {
  vendor: string;
  lines: InvoiceLine[];
  shipTo: { plant: string; address: string };
  taxable: boolean;
  freightCents: number;
  serviceCharge: boolean;
  attendees: number | null;
  notes: string[];
};

type CatSpec = {
  employees: string[];
  projects: (date: Date) => string[];
  build: (r: Rng, date: Date) => Built;
};

const TRAVEL_DEST = [
  { iata: "CHA", city: "Chattanooga, TN" },
  { iata: "SAT", city: "San Antonio, TX" },
  { iata: "LRD", city: "Laredo, TX (Monterrey supplier visit)" },
  { iata: "CMH", city: "Columbus, OH" },
  { iata: "GRR", city: "Grand Rapids, MI" },
];

const beforeDieClose = (d: Date) => d.getTime() < Date.UTC(2026, 8, 20);

const SPECS: Record<Category, CatSpec> = {
  "Supplier Audit Travel": {
    employees: ["Elena Vasquez", "Sofia Marin"],
    projects: () => ["PRJ-Tier2-Audit", "PRJ-Tier2-Audit", "PRJ-Airbag-Inflator-26"],
    build: (r) => {
      const dest = pick(r, TRAVEL_DEST);
      const nights = int(r, 3, 8);
      return {
        vendor: "Northline Travel Management",
        lines: [
          { partNumber: "TRV-AIR", description: `Airfare DTW–${dest.iata} round trip, economy (taxes incl.)`, quantity: 1, unit: "trip", unitPriceCents: roundTo(int(r, 38_000, 64_000), 100) },
          { partNumber: "TRV-LODGE", description: `Hotel lodging, ${dest.city} (taxes incl.)`, quantity: nights, unit: "night", unitPriceCents: roundTo(int(r, 13_900, 18_200), 100) },
          { partNumber: "TRV-PERDIEM", description: "Per diem — meals & incidentals", quantity: nights, unit: "day", unitPriceCents: 7_400 },
          { partNumber: "TRV-CAR", description: "Rental car, compact (taxes incl.)", quantity: nights, unit: "day", unitPriceCents: roundTo(int(r, 4_900, 6_200), 100) },
        ],
        shipTo: { plant: "Supplier Quality — supplier audit trip", address: "2600 Featherstone Rd, Auburn Hills, MI" },
        taxable: false,
        freightCents: 0,
        serviceCharge: false,
        attendees: null,
        notes: ["Supplier process audit (IATF 16949)."],
      };
    },
  },
  "Prototype Material": {
    employees: ["Aisha Bell", "Marcus Reed"],
    projects: () => ["PRJ-ADAS-Bracket-31", "PRJ-Airbag-Inflator-26", "PRJ-Seatbelt-Crash-07", "PRJ-Noise-Vacuum-Lab"],
    build: (r) => ({
      vendor: "ProtoWorks Additive Manufacturing",
      lines: pickLines(r, [ITEMS.slaGen, ITEMS.cncGen, ITEMS.web, ITEMS.sls, ITEMS.engHr], 2, 4),
      shipTo: PLANTS.auburnHills,
      taxable: true,
      freightCents: 0,
      serviceCharge: false,
      attendees: null,
      notes: ["APQP phase 2 prototype build."],
    }),
  },
  "R&D Track Testing": {
    employees: ["Marcus Reed", "Aisha Bell"],
    projects: () => ["PRJ-Seatbelt-Crash-07", "PRJ-Airbag-Inflator-26", "PRJ-Noise-Vacuum-Lab", "PRJ-ADAS-Bracket-31"],
    build: (r) => ({
      vendor: "Midwest Proving Grounds LLC",
      lines: r() < 0.5 ? pickLines(r, [ITEMS.pgDay, ITEMS.daq], 1, 2) : pickLines(r, [ITEMS.sled, ITEMS.atd, ITEMS.daq], 2, 3),
      shipTo: PLANTS.romeo,
      taxable: false,
      freightCents: 0,
      serviceCharge: false,
      attendees: null,
      notes: ["Test services — Michigan sales tax does not apply."],
    }),
  },
  "Factory Logistics": {
    employees: ["James O'Connor"],
    projects: () => ["PRJ-Battery-Tray-26", "PRJ-LineB-Upgrade", "PRJ-Airbag-Inflator-26"],
    build: (r) => {
      const lines = pickLines(r, [ITEMS.ltl, ITEMS.hotshot, ITEMS.customs, ITEMS.detention], 2, 3);
      const ltl = lines.find((l) => l.partNumber === "FRT-LTL");
      if (ltl) lines.push({ partNumber: "FRT-FSC", description: "Fuel surcharge", quantity: 1, unit: "ea", unitPriceCents: roundTo(ltl.quantity * ltl.unitPriceCents * (0.06 + r() * 0.03), 100) });
      return {
        vendor: "Buckeye Freight Systems",
        lines,
        shipTo: pick(r, [PLANTS.chattanooga, PLANTS.toledo, PLANTS.laredo]),
        taxable: false,
        freightCents: 0,
        serviceCharge: false,
        attendees: null,
        notes: ["Freight services — tax exempt."],
      };
    },
  },
  "Client Entertainment": {
    employees: ["Tyler Brooks", "Priya Natarajan", "James O'Connor", "Elena Vasquez", "Marcus Reed"],
    projects: () => ["PRJ-LineB-Upgrade", "PRJ-Seatbelt-Crash-07", "PRJ-Battery-Tray-26", "PRJ-Airbag-Inflator-26"],
    build: (r) => {
      const guests = int(r, 4, 10);
      return {
        vendor: "The Vantage Room Detroit",
        lines: [{ partNumber: "EVT-DINNER", description: "OEM program dinner — set menu", quantity: guests, unit: "guest", unitPriceCents: roundTo(int(r, 8_500, 10_000), 50) }],
        shipTo: { plant: "Private dining — OEM program review", address: "1500 Woodward Ave, Detroit, MI" },
        taxable: true,
        freightCents: 0,
        serviceCharge: true,
        attendees: guests,
        notes: [],
      };
    },
  },
  "Direct Parts Procurement": {
    employees: ["James O'Connor"],
    projects: () => ["PRJ-Battery-Tray-26", "PRJ-Seatbelt-Crash-07", "PRJ-Airbag-Inflator-26", "PRJ-LineB-Upgrade"],
    build: (r) => {
      const mcs = r() < 0.55;
      return {
        vendor: mcs ? "Motor City Steel & Stampings" : "Buckeye Fastener Supply",
        lines: mcs ? pickLines(r, [ITEMS.bracket, ITEMS.tray, ITEMS.inflHsg], 1, 3) : pickLines(r, [ITEMS.bolt, ITEMS.conn, ITEMS.clip], 2, 3),
        shipTo: pick(r, [PLANTS.toledo, PLANTS.chattanooga, PLANTS.sanAntonio]),
        taxable: false,
        freightCents: roundTo(int(r, 25_000, 120_000), 500),
        serviceCharge: false,
        attendees: null,
        notes: ["Production material — manufacturing exemption.", "EDI 810 / ASN 856 matched."],
      };
    },
  },
  "Tooling & Dies": {
    employees: ["Tyler Brooks", "Priya Natarajan", "Sofia Marin"],
    projects: (d) => (beforeDieClose(d) ? ["PRJ-Die-Refurb-19", "PRJ-Die-Refurb-19", "PRJ-LineB-Upgrade", "PRJ-Battery-Tray-26"] : ["PRJ-LineB-Upgrade", "PRJ-Battery-Tray-26"]),
    build: (r, d) => ({
      vendor: d.getTime() < Date.UTC(2026, 7, 25) ? "Great Lakes Die & Tool" : "Motor City Steel & Stampings",
      lines: pickLines(r, [ITEMS.dieInsert, ITEMS.dieLabor, ITEMS.screw, ITEMS.tryout], 2, 3),
      shipTo: PLANTS.toledo,
      taxable: false,
      freightCents: roundTo(int(r, 80_000, 400_000), 500),
      serviceCharge: false,
      attendees: null,
      notes: ["Capital tooling — PPAP tool tag issued.", "Manufacturing exemption — sales tax $0.00."],
    }),
  },
  "MRO & Equipment Repair": {
    employees: ["Tyler Brooks", "Priya Natarajan"],
    projects: (d) => (beforeDieClose(d) ? ["PRJ-LineB-Upgrade", "PRJ-Die-Refurb-19", "PRJ-Noise-Vacuum-Lab"] : ["PRJ-LineB-Upgrade", "PRJ-LineB-Upgrade", "PRJ-Noise-Vacuum-Lab"]),
    build: (r) => {
      const which = int(r, 0, 3);
      const vendor = ["Toledo Conveyor & Maintenance", "Lone Star Robotics Integration", "Midwest Industrial Supply", "Hexagon Metrology Services"][which];
      const items = [
        [ITEMS.belt, ITEMS.millwright, ITEMS.oil],
        [ITEMS.robotPm, ITEMS.integ],
        [ITEMS.forkBatt, ITEMS.oil, ITEMS.abrasive],
        [ITEMS.cmm, ITEMS.gage],
      ][which];
      return {
        vendor,
        lines: pickLines(r, items, 1, items.length),
        shipTo: pick(r, [PLANTS.toledo, PLANTS.chattanooga, PLANTS.sanAntonio]),
        taxable: false,
        freightCents: which === 2 ? roundTo(int(r, 15_000, 60_000), 500) : 0,
        serviceCharge: false,
        attendees: null,
        notes: ["Industrial processing exemption — sales tax $0.00."],
      };
    },
  },
  "Professional Services & Software": {
    employees: ["Marcus Reed", "Aisha Bell", "Priya Natarajan"],
    projects: () => ["PRJ-ADAS-Bracket-31", "PRJ-Airbag-Inflator-26", "PRJ-Seatbelt-Crash-07", "PRJ-LineB-Upgrade", "PRJ-Noise-Vacuum-Lab"],
    build: (r) => {
      const cad = r() < 0.6;
      return {
        vendor: cad ? "CADworx Solutions" : "Hexagon Metrology Services",
        lines: cad ? pickLines(r, [ITEMS.cae, ITEMS.fea], 1, 2) : pickLines(r, [ITEMS.ppap, ITEMS.gage], 1, 2),
        shipTo: PLANTS.auburnHills,
        taxable: false,
        freightCents: 0,
        serviceCharge: false,
        attendees: null,
        notes: ["Professional services — not subject to Michigan sales tax."],
      };
    },
  },
  "Warranty & Containment": {
    employees: ["Elena Vasquez", "Sofia Marin"],
    projects: () => ["PRJ-Airbag-Inflator-26", "PRJ-Seatbelt-Crash-07", "PRJ-Tier2-Audit"],
    build: (r) => ({
      vendor: "Summit Containment Services",
      lines: pickLines(r, [ITEMS.sort, ITEMS.inspect, ITEMS.shuttle], 2, 3),
      shipTo: PLANTS.chattanooga,
      taxable: false,
      freightCents: 0,
      serviceCharge: false,
      attendees: null,
      notes: ["Containment services — chargeback to supplier under review."],
    }),
  },
};

const CATEGORY_COUNTS: [Category, number][] = [
  ["Direct Parts Procurement", 26],
  ["Tooling & Dies", 20],
  ["MRO & Equipment Repair", 16],
  ["Prototype Material", 11],
  ["Professional Services & Software", 10],
  ["Factory Logistics", 10],
  ["R&D Track Testing", 7],
  ["Warranty & Containment", 7],
  ["Supplier Audit Travel", 8],
  ["Client Entertainment", 6],
];

type Anomaly =
  | "missingProject" | "duplicate" | "overLimit" | "missingGrn" | "vendorNotApproved" | "poBalance" | "bankChange"
  | "split" | "priceVariance" | "tax" | "travel" | "entertainment" | "weekendMeal" | "lowOcr" | "approval" | "capex";

const ANOMALY_PLAN: [Anomaly, number, Category[] | "any"][] = [
  ["split", 1, ["Factory Logistics"]],
  ["vendorNotApproved", 1, ["Tooling & Dies"]],
  ["bankChange", 1, ["Direct Parts Procurement"]],
  ["duplicate", 3, ["Direct Parts Procurement", "Tooling & Dies", "Factory Logistics"]],
  ["overLimit", 2, ["MRO & Equipment Repair", "Factory Logistics"]],
  ["missingGrn", 3, ["Direct Parts Procurement", "Warranty & Containment", "MRO & Equipment Repair"]],
  ["poBalance", 2, ["Professional Services & Software", "MRO & Equipment Repair"]],
  ["missingProject", 3, ["Direct Parts Procurement", "Factory Logistics", "Warranty & Containment"]],
  ["travel", 3, ["Supplier Audit Travel"]],
  ["entertainment", 2, ["Client Entertainment"]],
  ["weekendMeal", 1, ["Client Entertainment"]],
  ["tax", 2, ["Prototype Material"]],
  ["capex", 2, ["Professional Services & Software", "Tooling & Dies"]],
  ["priceVariance", 4, ["Prototype Material", "Direct Parts Procurement", "MRO & Equipment Repair", "R&D Track Testing"]],
  ["lowOcr", 4, "any"],
  ["approval", 4, "any"],
];

const GUEST_NAMES = ["R. Holloway", "C. Duarte", "B. Kessler", "N. Ferris", "A. Lindqvist", "P. Shaw", "M. Ortega", "J. Brandt", "S. Whitaker", "L. Kim", "E. Novak", "T. Ruiz"];

export type HistoricalData = { claims: ClaimSeed[]; pos: PoSeed[]; grns: GrnSeed[] };

const START = Date.UTC(2025, 10, 1, 12);
const END = Date.UTC(2026, 9, 25, 20);

export function generateHistorical(seed = 20261029): HistoricalData {
  const r = mulberry32(seed);

  // 1. Dates and categories.
  const bag: Category[] = CATEGORY_COUNTS.flatMap(([c, n]) => Array<Category>(n).fill(c));
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  const dates = bag
    .map(() => START + Math.floor(r() * (END - START)))
    .sort((a, b) => a - b)
    .map((t) => {
      const d = new Date(t);
      d.setUTCHours(int(r, 12, 21), int(r, 0, 59), 0, 0);
      return d;
    });

  const n = bag.length;
  const statusOf = (i: number): ClaimStatus => (i >= n - 12 ? "Pending" : i >= n - 36 ? "Analyzed" : "Posted");

  // 2. Assign anomalies to analyzed/posted slots.
  const anomalies: (Anomaly | null)[] = Array(n).fill(null);
  for (const [kind, count, cats] of ANOMALY_PLAN) {
    for (let k = 0; k < count; k++) {
      const candidates = bag
        .map((c, i) => i)
        .filter((i) => statusOf(i) !== "Pending" && anomalies[i] === null && (cats === "any" || cats.includes(bag[i])))
        // Duplicates need an earlier claim to copy; split needs room for a sibling before the pending block.
        .filter((i) => (kind === "duplicate" ? i > 10 : kind === "split" ? i < n - 40 : true));
      if (candidates.length === 0) continue;
      anomalies[pick(r, candidates)] = kind;
    }
  }

  const claims: ClaimSeed[] = [];
  const pos: PoSeed[] = [];
  const grns: GrnSeed[] = [];
  let poSeq = 4_501_000;
  let grnSeq = 7_000;
  const invSeq: Record<string, number> = {};
  const reservedInvoices = new Set([...HERO_CLAIMS, DUPLICATE_ORIGINAL].map((c) => c.doc.invoiceNumber));
  const fixed = [...HERO_CLAIMS, DUPLICATE_ORIGINAL];

  const nextInvoice = (vendor: string, date: Date) => {
    const prefix = vendorByName(vendor).invoicePrefix;
    let num: string;
    do {
      invSeq[prefix] = (invSeq[prefix] ?? int(r, 100, 400)) + int(r, 3, 17);
      const s = invSeq[prefix];
      num =
        prefix === "LSRI" || prefix === "TVR" || prefix === "GLD"
          ? `${prefix}-${date.getUTCFullYear()}-${String(s).padStart(4, "0")}`
          : prefix === "BFS"
            ? `${prefix}-${76_000 + s}`
            : prefix === "MPG"
              ? `${prefix}-${87_000 + s}`
              : `${prefix}-${String(10_000 + s * 7)}`;
    } while (reservedInvoices.has(num));
    reservedInvoices.add(num);
    return num;
  };

  const tooClose = (vendor: string, cents: number, date: Date, exclude?: ClaimSeed) =>
    [...claims, ...fixed].some(
      (c) =>
        c !== exclude &&
        c.vendorName === vendor &&
        Math.abs(c.submittedAt.getTime() - date.getTime()) <= 95 * 86_400_000 &&
        Math.abs(totalCents(c.doc) - cents) <= cents * 0.025,
    );

  const build = (i: number, cat: Category, date: Date, anomaly: Anomaly | null, forced?: Partial<{ vendor: string; project: string; target: number }>): ClaimSeed => {
    const spec = SPECS[cat];
    const policy = policyFor(cat);
    const built = spec.build(r, date);
    let vendor = forced?.vendor ?? built.vendor;
    const employee = pick(r, spec.employees);
    const emp = EMPLOYEES.find((e) => e.name === employee)!;
    let project: string | null = forced?.project ?? pick(r, spec.projects(date));
    let lines = built.lines;
    const status = statusOf(i);

    // Invoice date: 2–12 days before submission; meals on weekdays unless the anomaly says otherwise.
    let invDate = addDays(date, -int(r, 2, 12));
    if (cat === "Client Entertainment") {
      while (isWeekend(toIsoDate(invDate)) !== (anomaly === "weekendMeal")) invDate = addDays(invDate, -1);
    }

    if (anomaly === "duplicate") {
      const prior = [...claims].reverse().find((c) => c.category === cat && date.getTime() - c.submittedAt.getTime() < 75 * 86_400_000);
      if (prior) {
        vendor = prior.vendorName;
        project = prior.projectCode;
        lines = prior.doc.lines.map((l) => ({ ...l }));
      }
    }
    if (anomaly === "vendorNotApproved") vendor = "Rapid Tooling Express";

    const scaleTo = (target: number) => {
      const fixedPart = built.freightCents;
      const cur = lines.reduce((s, l) => s + l.quantity * l.unitPriceCents, 0);
      const f = (target - fixedPart) / cur;
      const big = lines.reduce((a, b) => (a.quantity * a.unitPriceCents >= b.quantity * b.unitPriceCents ? a : b));
      const rest = cur - big.quantity * big.unitPriceCents;
      big.quantity = Math.max(1, Math.round((cur * f - rest) / big.unitPriceCents));
    };

    // Keep clean claims comfortably below the limit (and outside the split band).
    const cap = Math.round(policy.perClaimLimitCents * 0.75);
    const amountOf = () => draftTotal(lines, built);
    if (forced?.target) scaleTo(forced.target);
    else if (anomaly === "overLimit") scaleTo(Math.round(policy.perClaimLimitCents * (1.08 + r() * 0.15)));
    else {
      for (let guard = 0; amountOf() > cap && guard < 40; guard++) {
        const big = lines.reduce((a, b) => (a.quantity * a.unitPriceCents >= b.quantity * b.unitPriceCents ? a : b));
        if (big.quantity > 1) big.quantity = Math.max(1, Math.floor(big.quantity * 0.85));
        else lines = lines.length > 1 ? lines.filter((l) => l !== big) : lines;
      }
    }
    if (anomaly === "priceVariance") {
      const bl = lines.find((l) => l.partNumber && Object.values(ITEMS).some((it) => "bench" in it && it.bench && it.code === l.partNumber));
      if (bl) bl.unitPriceCents = Math.round(bl.unitPriceCents * (r() < 0.5 ? 1.24 : 1.42));
    }
    if (anomaly === "travel") {
      const lodge = lines.find((l) => l.partNumber === "TRV-LODGE");
      if (lodge) lodge.unitPriceCents = roundTo(int(r, 21_500, 24_500), 100);
    }
    if (anomaly === "entertainment") {
      const guests = lines[0].quantity;
      lines.push({ partNumber: "EVT-BEV", description: "Wine & spirits pairing", quantity: guests, unit: "guest", unitPriceCents: 3_500 });
    }

    // Avoid accidental duplicates (R-03) for everything except the planned ones.
    if (anomaly !== "duplicate") {
      for (let guard = 0; tooClose(vendor, amountOf(), date) && guard < 30; guard++) {
        const big = lines.reduce((a, b) => (a.quantity * a.unitPriceCents >= b.quantity * b.unitPriceCents ? a : b));
        if (big.quantity >= 20) big.quantity = Math.floor(big.quantity * 0.94);
        else big.unitPriceCents = Math.round(big.unitPriceCents * 0.95);
      }
    }

    const sub = lines.reduce((s, l) => s + Math.round(l.quantity * l.unitPriceCents), 0);
    const service = built.serviceCharge ? Math.round(sub * 0.18) : 0;
    const taxRate = built.taxable ? (anomaly === "tax" ? 0.075 : 0.06) : 0;
    const salesTax = Math.round((sub + service) * taxRate);
    const amount = sub + service + salesTax + built.freightCents;

    // Approval at the required level unless the anomaly says otherwise.
    const required = requiredApprovalLevel(amount);
    const reqIdx = APPROVAL_LEVELS.indexOf(required);
    const approval =
      anomaly === "approval"
        ? reqIdx === 0
          ? null
          : { name: pick(r, APPROVERS[APPROVAL_LEVELS[reqIdx - 1]]), level: APPROVAL_LEVELS[reqIdx - 1] }
        : { name: pick(r, APPROVERS[required]), level: required };

    // PO + GRN
    let poNumber: string | null = null;
    let grnNumber: string | null = null;
    let gatePass: string | null = null;
    if (policy.requiresPo) {
      poNumber = String(poSeq++);
      const poAmount =
        anomaly === "poBalance" ? roundTo(amount * (0.7 + r() * 0.12), 50_000) : roundTo(amount * (1.02 + r() * 0.25), 50_000) + 50_000;
      const capitalCats: Category[] = ["Tooling & Dies", "Professional Services & Software"];
      pos.push({
        poNumber,
        vendor,
        projectCode: project ?? pick(r, spec.projects(date)),
        amountCents: poAmount,
        consumedCents: status === "Posted" ? Math.min(poAmount, amount) : 0,
        costType: capitalCats.includes(cat) && anomaly !== "capex" ? "Capital" : "Expense",
        issuedAt: toIsoDate(addDays(invDate, -int(r, 10, 45))),
        status: status === "Posted" ? "Closed" : "Open",
        description: `${cat} — ${vendor}`,
      });
      if (policy.requiresGrn && anomaly !== "missingGrn") {
        grnSeq += int(r, 1, 9);
        grnNumber = `GRN-${invDate.getUTCFullYear()}-${grnSeq}`;
        gatePass = `GP-${built.shipTo.address.includes("Toledo") ? "TOL" : built.shipTo.address.includes("Chattanooga") ? "CHA" : built.shipTo.address.includes("Laredo") ? "LRD" : built.shipTo.address.includes("San Antonio") ? "SAT" : "AH"}-${int(r, 10_000, 59_999)}`;
        grns.push({
          grnNumber,
          poNumber,
          gatePassNumber: gatePass,
          receivedAt: toIsoDate(addDays(invDate, -int(r, 0, 3))),
          quantity: lines.reduce((s, l) => s + Math.round(l.quantity), 0),
          amountCents: sub,
          plant: built.shipTo.address.split(", ").slice(-2).join(", "),
        });
      }
    }
    if (anomaly === "missingProject") project = null;

    const claimId = "TBD";
    const doc = makeDoc({
      claimId,
      vendor,
      invoiceNumber: nextInvoice(vendor, invDate),
      invoiceDate: toIsoDate(invDate),
      poNumber,
      grnNumber,
      gatePassNumber: gatePass,
      projectCode: project,
      shipTo: built.shipTo,
      lines,
      taxRate,
      salesTaxCents: salesTax,
      freightCents: built.freightCents,
      otherChargesCents: service,
      otherChargesLabel: "Service charge (18%)",
      approval,
      attendees:
        built.attendees !== null
          ? {
              count: lines[0].quantity,
              names:
                anomaly === "entertainment"
                  ? []
                  : Array.from({ length: lines[0].quantity }, (_, k) => `${GUEST_NAMES[(k + i) % GUEST_NAMES.length]} (${["Lakeshore Motors", "Summit Motor Co.", "Cascade EV", "Ironwood"][k % 4]})`),
            }
          : null,
      notes: built.notes,
      confidence: anomaly === "lowOcr" ? (r() < 0.5 ? { total: 0.68 } : { invoiceNumber: 0.71 }) : {},
      bankOverride: anomaly === "bankChange" ? { bankName: "Fifth Coast Bank", accountLast4: "6672" } : undefined,
    });

    const cycleHours = Math.round((1.5 + r() * 16) * 10) / 10;
    return {
      claimId,
      employee,
      department: emp.department as Department,
      projectCode: project,
      category: cat,
      vendorName: vendor,
      poNumber,
      grnNumber,
      submittedAt: date,
      status,
      cycleHours: status === "Pending" ? undefined : cycleHours,
      postedAt: status === "Posted" ? new Date(date.getTime() + cycleHours * 3_600_000 + int(r, 20, 96) * 3_600_000) : undefined,
      doc,
      plannedAnomaly: anomaly,
    };
  };

  for (let i = 0; i < n; i++) {
    const cat = bag[i];
    if (anomalies[i] === "split") {
      const limit = policyFor(cat).perClaimLimitCents;
      const first = build(i, cat, dates[i], null, { target: Math.round(limit * 0.86) });
      first.plannedAnomaly = "split-first";
      claims.push(first);
      const sibling = build(i, cat, new Date(dates[i].getTime() + 2 * 86_400_000), "split", {
        vendor: first.vendorName,
        project: first.projectCode ?? undefined,
        target: Math.round(limit * 0.93),
      });
      claims.push(sibling);
      continue;
    }
    claims.push(build(i, cat, dates[i], anomalies[i]));
  }

  // The posted original that hero CLM-2026-0145 duplicates.
  claims.push(DUPLICATE_ORIGINAL);
  claims.sort((a, b) => a.submittedAt.getTime() - b.submittedAt.getTime());

  // 3. Assign claim IDs chronologically per year (CLM-2026-0142+ are reserved for the hero claims).
  const seq: Record<number, number> = {};
  for (const c of claims) {
    const y = c.submittedAt.getUTCFullYear();
    seq[y] = (seq[y] ?? 0) + 1;
    c.claimId = `CLM-${y}-${String(seq[y]).padStart(4, "0")}`;
    c.doc.claimId = c.claimId;
  }
  if ((seq[2026] ?? 0) >= 142) throw new Error("Historical 2026 claims collide with hero claim IDs");

  return { claims, pos, grns };
}

function draftTotal(lines: InvoiceLine[], built: Built): number {
  const sub = lines.reduce((s, l) => s + Math.round(l.quantity * l.unitPriceCents), 0);
  const service = built.serviceCharge ? Math.round(sub * 0.18) : 0;
  const tax = built.taxable ? Math.round((sub + service) * 0.06) : 0;
  return sub + service + tax + built.freightCents;
}
