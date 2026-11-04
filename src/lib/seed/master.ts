import type { Category, Department } from "@/lib/domain/constants";

// Fictional master data for Ironwood Safety Systems, Inc. Money in integer cents.

export const EMPLOYEES: { name: string; department: Department | "Corporate Audit"; title: string }[] = [
  { name: "Marcus Reed", department: "R&D Engineering", title: "Crash Safety Engineer" },
  { name: "Elena Vasquez", department: "Supplier Quality", title: "Supplier Quality Engineer" },
  { name: "Priya Natarajan", department: "Plant Operations", title: "Plant Controller" },
  { name: "James O'Connor", department: "Supply Chain", title: "Logistics Manager" },
  { name: "Aisha Bell", department: "R&D Engineering", title: "Prototype Engineering Lead" },
  { name: "Tyler Brooks", department: "Plant Operations", title: "Maintenance Manager" },
  { name: "Sofia Marin", department: "Supplier Quality", title: "Supplier Audit Lead" },
  { name: "Dana Whitfield", department: "Corporate Audit", title: "Audit Director (demo user)" },
  // Routing-role owners (D-34): every ROUTING role has exactly one owner. They submit no seeded claims.
  { name: "Grace Whitaker", department: "R&D Engineering", title: "R&D Finance Partner" },
  { name: "Hannah Lindqvist", department: "Supplier Quality", title: "Supplier Quality Manager" },
  { name: "Omar Haddad", department: "Supply Chain", title: "Supply Chain Controller" },
];

export type ProjectSeed = {
  code: string;
  name: string;
  department: Department;
  budgetCents: number;
  startDate: string;
  endDate: string | null;
  customerProgram: string;
  status: "Active" | "Closed";
};

export const PROJECTS: ProjectSeed[] = [
  { code: "PRJ-Seatbelt-Crash-07", name: "Seatbelt crash-sled validation", department: "R&D Engineering", budgetCents: 180_000_000, startDate: "2025-06-01", endDate: "2027-06-30", customerProgram: "Lakeshore Motors LMX-7 crossover", status: "Active" },
  { code: "PRJ-Airbag-Inflator-26", name: "Next-gen inflator qualification", department: "R&D Engineering", budgetCents: 240_000_000, startDate: "2025-09-01", endDate: "2027-12-31", customerProgram: "Summit Motor Company SMC-9 pickup", status: "Active" },
  { code: "PRJ-Battery-Tray-26", name: "Battery tray extrusion program", department: "Supply Chain", budgetCents: 310_000_000, startDate: "2025-08-01", endDate: "2027-09-30", customerProgram: "Cascade EV E1 platform", status: "Active" },
  { code: "PRJ-ADAS-Bracket-31", name: "ADAS sensor bracket", department: "R&D Engineering", budgetCents: 95_000_000, startDate: "2025-10-01", endDate: "2027-03-31", customerProgram: "Cascade EV E1 platform", status: "Active" },
  { code: "PRJ-LineB-Upgrade", name: "Toledo Line B automation upgrade", department: "Plant Operations", budgetCents: 420_000_000, startDate: "2025-07-01", endDate: "2027-06-30", customerProgram: "Lakeshore Motors LMX-7 crossover", status: "Active" },
  { code: "PRJ-Tier2-Audit", name: "Tier-2 supplier audit program", department: "Supplier Quality", budgetCents: 60_000_000, startDate: "2025-04-01", endDate: "2027-03-31", customerProgram: "All programs (IATF 16949)", status: "Active" },
  { code: "PRJ-Die-Refurb-19", name: "Die refurbishment campaign", department: "Plant Operations", budgetCents: 110_000_000, startDate: "2025-03-01", endDate: "2026-09-30", customerProgram: "Summit Motor Company SMC-9 pickup", status: "Closed" },
  { code: "PRJ-Noise-Vacuum-Lab", name: "NVH vacuum lab", department: "R&D Engineering", budgetCents: 75_000_000, startDate: "2025-05-01", endDate: "2027-05-31", customerProgram: "Internal R&D capability", status: "Active" },
];

export type VendorSeed = {
  vendorId: string;
  name: string;
  category: string;
  street: string;
  city: string;
  state: string;
  taxId: string;
  approved: boolean;
  w9OnFile: boolean;
  w9ExpiresAt: string | null;
  insuranceExpiresAt: string | null;
  paymentTerms: string;
  bankName: string;
  bankAccountLast4: string;
  invoicePrefix: string;
};

const v = (s: Omit<VendorSeed, "w9OnFile" | "paymentTerms" | "approved" | "w9ExpiresAt" | "insuranceExpiresAt"> & Partial<VendorSeed>): VendorSeed => ({
  approved: true,
  w9OnFile: true,
  w9ExpiresAt: "2028-01-31",
  insuranceExpiresAt: "2027-06-30",
  paymentTerms: "Net 60",
  ...s,
});

export const VENDORS: VendorSeed[] = [
  v({ vendorId: "V-1001", name: "Motor City Steel & Stampings", category: "Direct materials", street: "23400 Hoover Rd", city: "Warren", state: "MI", taxId: "38-2716645", bankName: "Great Lakes Commerce Bank", bankAccountLast4: "4471", invoicePrefix: "MCS" }),
  v({ vendorId: "V-1002", name: "Great Lakes Die & Tool", category: "Tooling & dies", street: "4150 East Paris Ave SE", city: "Grand Rapids", state: "MI", taxId: "38-3390218", w9ExpiresAt: "2026-08-31", bankName: "West Michigan Trust", bankAccountLast4: "8820", invoicePrefix: "GLD" }),
  v({ vendorId: "V-1003", name: "Buckeye Fastener Supply", category: "Fasteners", street: "1850 Westbelt Dr", city: "Columbus", state: "OH", taxId: "31-1874402", bankName: "Buckeye National Bank", bankAccountLast4: "1937", invoicePrefix: "BFAS" }),
  v({ vendorId: "V-1004", name: "Lone Star Robotics Integration", category: "Automation / MRO", street: "9800 Metric Blvd", city: "Austin", state: "TX", taxId: "74-3051186", bankName: "Lone Star Commerce Bank", bankAccountLast4: "6604", invoicePrefix: "LSRI" }),
  v({ vendorId: "V-1005", name: "Toledo Conveyor & Maintenance", category: "MRO", street: "3301 Hill Ave", city: "Toledo", state: "OH", taxId: "34-1728813", bankName: "Maumee Valley Bank", bankAccountLast4: "2258", invoicePrefix: "TCM" }),
  v({ vendorId: "V-1006", name: "Midwest Proving Grounds LLC", category: "Track testing", street: "71000 Van Dyke Rd", city: "Romeo", state: "MI", taxId: "38-4417290", bankName: "Huron Valley Bank", bankAccountLast4: "5512", invoicePrefix: "MPG" }),
  v({ vendorId: "V-1007", name: "ProtoWorks Additive Manufacturing", category: "Prototype", street: "46900 Grand River Ave", city: "Novi", state: "MI", taxId: "38-3982251", bankName: "Great Lakes Commerce Bank", bankAccountLast4: "7093", invoicePrefix: "PW" }),
  v({ vendorId: "V-1008", name: "Northline Travel Management", category: "Travel", street: "222 W Adams St", city: "Chicago", state: "IL", taxId: "36-4120967", bankName: "Lakefront Bank of Chicago", bankAccountLast4: "3346", invoicePrefix: "NTM" }),
  v({ vendorId: "V-1009", name: "Buckeye Freight Systems", category: "Logistics", street: "5500 Wolf Creek Pike", city: "Dayton", state: "OH", taxId: "31-1559034", bankName: "Buckeye National Bank", bankAccountLast4: "9081", invoicePrefix: "BFS" }),
  v({ vendorId: "V-1010", name: "Hexagon Metrology Services", category: "Calibration", street: "28700 Cabot Dr", city: "Novi", state: "MI", taxId: "38-2690417", bankName: "Huron Valley Bank", bankAccountLast4: "6219", invoicePrefix: "HMS" }),
  v({ vendorId: "V-1011", name: "Midwest Industrial Supply", category: "MRO consumables", street: "4800 Lakeside Ave E", city: "Cleveland", state: "OH", taxId: "34-0981126", bankName: "Cuyahoga Savings Bank", bankAccountLast4: "4402", invoicePrefix: "MIS" }),
  v({ vendorId: "V-1012", name: "The Vantage Room Detroit", category: "Entertainment", street: "1500 Woodward Ave", city: "Detroit", state: "MI", taxId: "38-4022173", bankName: "Motor City Community Bank", bankAccountLast4: "0716", invoicePrefix: "TVR" }),
  v({ vendorId: "V-1013", name: "CADworx Solutions", category: "Software / services", street: "755 W Big Beaver Rd", city: "Troy", state: "MI", taxId: "38-3716654", bankName: "Great Lakes Commerce Bank", bankAccountLast4: "2830", invoicePrefix: "CWX" }),
  v({ vendorId: "V-1014", name: "Summit Containment Services", category: "Warranty / containment", street: "6400 Lee Hwy", city: "Chattanooga", state: "TN", taxId: "62-1844390", bankName: "Volunteer State Bank", bankAccountLast4: "5177", invoicePrefix: "SCS" }),
  v({ vendorId: "V-1015", name: "Rapid Tooling Express", category: "Tooling & dies", street: "1955 Barrett Dr", city: "Troy", state: "MI", taxId: "38-4590812", approved: false, w9OnFile: false, w9ExpiresAt: null, bankName: "Oakland County Bank", bankAccountLast4: "3390", invoicePrefix: "RTE" }),
];

export const vendorByName = (name: string) => {
  const found = VENDORS.find((x) => x.name === name);
  if (!found) throw new Error(`Unknown vendor ${name}`);
  return found;
};

export type PoSeed = {
  poNumber: string;
  vendor: string;
  projectCode: string;
  amountCents: number;
  consumedCents: number;
  costType: "Capital" | "Expense";
  issuedAt: string;
  status: "Open" | "Closed" | "On Hold";
  description: string;
};

/** The 12 open SAP POs the demo talks about. Historical claims carry their own generated POs. */
export const OPEN_POS: PoSeed[] = [
  { poNumber: "4500912", vendor: "Midwest Proving Grounds LLC", projectCode: "PRJ-Seatbelt-Crash-07", amountCents: 1_450_000, consumedCents: 0, costType: "Expense", issuedAt: "2026-09-22", status: "Open", description: "Proving-ground track days, Q4 crash-sled validation" },
  { poNumber: "4500934", vendor: "Northline Travel Management", projectCode: "PRJ-Tier2-Audit", amountCents: 324_000, consumedCents: 0, costType: "Expense", issuedAt: "2026-10-01", status: "Open", description: "Tier-2 audit travel — Chattanooga supplier visit" },
  { poNumber: "4500871", vendor: "Lone Star Robotics Integration", projectCode: "PRJ-LineB-Upgrade", amountCents: 9_800_000, consumedCents: 5_680_000, costType: "Expense", issuedAt: "2026-06-15", status: "Open", description: "Line B robot cell upgrade & commissioning" },
  { poNumber: "4500955", vendor: "Buckeye Freight Systems", projectCode: "PRJ-Battery-Tray-26", amountCents: 632_000, consumedCents: 0, costType: "Expense", issuedAt: "2026-10-05", status: "Open", description: "LTL freight — battery tray extrusions" },
  { poNumber: "4500962", vendor: "ProtoWorks Additive Manufacturing", projectCode: "PRJ-ADAS-Bracket-31", amountCents: 1_875_000, consumedCents: 0, costType: "Expense", issuedAt: "2026-10-02", status: "Open", description: "ADAS bracket SLA prototypes and CNC fixtures" },
  { poNumber: "4500899", vendor: "Great Lakes Die & Tool", projectCode: "PRJ-Die-Refurb-19", amountCents: 25_000_000, consumedCents: 21_000_000, costType: "Capital", issuedAt: "2026-03-10", status: "Open", description: "Progressive die refurbishment — seatbelt anchor line" },
  { poNumber: "4500948", vendor: "Buckeye Freight Systems", projectCode: "PRJ-Battery-Tray-26", amountCents: 1_200_000, consumedCents: 632_000, costType: "Expense", issuedAt: "2026-09-01", status: "Open", description: "LTL freight — September/October lanes" },
  { poNumber: "4500977", vendor: "Hexagon Metrology Services", projectCode: "PRJ-LineB-Upgrade", amountCents: 2_400_000, consumedCents: 840_000, costType: "Expense", issuedAt: "2026-05-20", status: "Open", description: "CMM calibration and gage R&R, Toledo" },
  { poNumber: "4500981", vendor: "CADworx Solutions", projectCode: "PRJ-ADAS-Bracket-31", amountCents: 6_000_000, consumedCents: 2_250_000, costType: "Capital", issuedAt: "2026-02-12", status: "Open", description: "CAE seat licenses and crash simulation services" },
  { poNumber: "4500990", vendor: "Summit Containment Services", projectCode: "PRJ-Airbag-Inflator-26", amountCents: 3_000_000, consumedCents: 1_280_000, costType: "Expense", issuedAt: "2026-07-08", status: "Open", description: "CS1 containment sorting — Chattanooga" },
  { poNumber: "4500902", vendor: "Motor City Steel & Stampings", projectCode: "PRJ-Battery-Tray-26", amountCents: 24_000_000, consumedCents: 15_000_000, costType: "Expense", issuedAt: "2026-01-15", status: "Open", description: "Blanket PO — battery tray extrusions (EDI 850)" },
  { poNumber: "4500915", vendor: "Toledo Conveyor & Maintenance", projectCode: "PRJ-LineB-Upgrade", amountCents: 4_500_000, consumedCents: 1_820_000, costType: "Expense", issuedAt: "2026-04-03", status: "On Hold", description: "Conveyor maintenance — Line B (hold pending rate review)" },
];

export type GrnSeed = { grnNumber: string; poNumber: string; gatePassNumber: string; receivedAt: string; quantity: number; amountCents: number; plant: string };

export const OPEN_GRNS: GrnSeed[] = [
  { grnNumber: "GRN-2026-8841", poNumber: "4500955", gatePassNumber: "GP-CHA-55120", receivedAt: "2026-10-23", quantity: 6, amountCents: 632_000, plant: "Chattanooga, TN" },
  { grnNumber: "GRN-2026-8852", poNumber: "4500962", gatePassNumber: "GP-AH-10288", receivedAt: "2026-10-21", quantity: 35, amountCents: 1_875_000, plant: "Auburn Hills, MI" },
  { grnNumber: "GRN-2026-8790", poNumber: "4500899", gatePassNumber: "GP-TOL-30472", receivedAt: "2026-09-26", quantity: 4, amountCents: 12_840_000, plant: "Toledo, OH" },
  { grnNumber: "GRN-2026-8822", poNumber: "4500948", gatePassNumber: "GP-CHA-55087", receivedAt: "2026-10-08", quantity: 6, amountCents: 632_000, plant: "Chattanooga, TN" },
  { grnNumber: "GRN-2026-8700", poNumber: "4500902", gatePassNumber: "GP-TOL-30110", receivedAt: "2026-08-14", quantity: 1200, amountCents: 7_740_000, plant: "Toledo, OH" },
  { grnNumber: "GRN-2026-8805", poNumber: "4500990", gatePassNumber: "GP-CHA-54990", receivedAt: "2026-09-30", quantity: 260, amountCents: 1_280_000, plant: "Chattanooga, TN" },
];

export type PolicySeed = {
  category: Category;
  perClaimLimitCents: number;
  requiresPo: boolean;
  requiresGrn: boolean;
  requiresProjectCode: boolean;
  approvalThresholdCents: number;
  notes: string;
};

export const POLICIES: PolicySeed[] = [
  { category: "Supplier Audit Travel", perClaimLimitCents: 500_000, requiresPo: false, requiresGrn: false, requiresProjectCode: true, approvalThresholdCents: 1_000_000, notes: "Lodging cap $184/night (Detroit GSA-style), airfare cap $650 domestic, per diem $74/day, economy only. Taxes included in fares." },
  { category: "Prototype Material", perClaimLimitCents: 2_500_000, requiresPo: true, requiresGrn: true, requiresProjectCode: true, approvalThresholdCents: 1_000_000, notes: "APQP prototype builds. GRN required at Auburn Hills receiving." },
  { category: "R&D Track Testing", perClaimLimitCents: 2_000_000, requiresPo: true, requiresGrn: false, requiresProjectCode: true, approvalThresholdCents: 1_000_000, notes: "Proving-ground day rates and crash-sled services. Service — no gate pass." },
  { category: "Factory Logistics", perClaimLimitCents: 1_500_000, requiresPo: true, requiresGrn: true, requiresProjectCode: true, approvalThresholdCents: 1_000_000, notes: "LTL, hotshot/premium freight, customs brokerage, detention. Premium freight needs MMOG/LE root cause." },
  { category: "Client Entertainment", perClaimLimitCents: 500_000, requiresPo: false, requiresGrn: false, requiresProjectCode: true, approvalThresholdCents: 1_000_000, notes: "$150 per head, alcohol discouraged, attendee list required." },
  { category: "Direct Parts Procurement", perClaimLimitCents: 7_500_000, requiresPo: true, requiresGrn: true, requiresProjectCode: true, approvalThresholdCents: 5_000_000, notes: "Three-way match against EDI 810 / ASN 856 / GRN 101." },
  { category: "Tooling & Dies", perClaimLimitCents: 15_000_000, requiresPo: true, requiresGrn: true, requiresProjectCode: true, approvalThresholdCents: 5_000_000, notes: "Capitalize above $5,000 unless PO is expense-coded maintenance. PPAP tool tag required." },
  { category: "MRO & Equipment Repair", perClaimLimitCents: 5_000_000, requiresPo: true, requiresGrn: true, requiresProjectCode: true, approvalThresholdCents: 5_000_000, notes: "Includes CMM calibration, robot/press repair, forklift batteries, hydraulic oil." },
  { category: "Professional Services & Software", perClaimLimitCents: 4_000_000, requiresPo: true, requiresGrn: false, requiresProjectCode: true, approvalThresholdCents: 1_000_000, notes: "CAE licenses, PPAP lab testing, engineering services. Capitalize software above $5,000." },
  { category: "Warranty & Containment", perClaimLimitCents: 3_000_000, requiresPo: true, requiresGrn: true, requiresProjectCode: true, approvalThresholdCents: 1_000_000, notes: "CS1/CS2 containment sorting, third-party inspection. Recoverable via supplier chargeback." },
];

export const policyFor = (category: Category) => {
  const p = POLICIES.find((x) => x.category === category);
  if (!p) throw new Error(`No policy for ${category}`);
  return p;
};

export type BenchmarkSeed = { itemCode: string; category: Category; description: string; unit: string; p50Cents: number; p90Cents: number };

export const BENCHMARKS: BenchmarkSeed[] = [
  { itemCode: "SVC-PG-DAY", category: "R&D Track Testing", description: "Proving ground track day", unit: "day", p50Cents: 725_000, p90Cents: 810_000 },
  { itemCode: "SVC-SLED-RUN", category: "R&D Track Testing", description: "Crash-sled run", unit: "run", p50Cents: 185_000, p90Cents: 214_000 },
  { itemCode: "SVC-ATD-CAL", category: "R&D Track Testing", description: "Crash-test dummy calibration", unit: "ea", p50Cents: 240_000, p90Cents: 275_000 },
  { itemCode: "SLA-BRKT-ADAS", category: "Prototype Material", description: "SLA prototype bracket — ADAS", unit: "ea", p50Cents: 32_000, p90Cents: 39_000 },
  { itemCode: "SLA-BRKT-GEN", category: "Prototype Material", description: "SLA prototype bracket", unit: "ea", p50Cents: 28_500, p90Cents: 34_000 },
  { itemCode: "CNC-FIX-ADAS", category: "Prototype Material", description: "CNC inspection fixture", unit: "ea", p50Cents: 56_000, p90Cents: 64_000 },
  { itemCode: "CNC-FIX-GEN", category: "Prototype Material", description: "CNC check fixture", unit: "ea", p50Cents: 64_000, p90Cents: 73_000 },
  { itemCode: "PROTO-WEB-48", category: "Prototype Material", description: "Prototype seatbelt webbing 48 mm", unit: "m", p50Cents: 640, p90Cents: 760 },
  { itemCode: "SVC-ENG-HR", category: "Prototype Material", description: "Engineering support hour", unit: "hr", p50Cents: 15_000, p90Cents: 17_500 },
  { itemCode: "FRT-LTL", category: "Factory Logistics", description: "LTL shipment, Midwest lane", unit: "shipment", p50Cents: 92_000, p90Cents: 108_000 },
  { itemCode: "FRT-HOTSHOT", category: "Factory Logistics", description: "Hotshot expedited load", unit: "load", p50Cents: 165_000, p90Cents: 198_000 },
  { itemCode: "BRKT-STMP-ANCHOR", category: "Direct Parts Procurement", description: "Stamped seatbelt anchor bracket", unit: "ea", p50Cents: 285, p90Cents: 320 },
  { itemCode: "BTRAY-EXTR-6061", category: "Direct Parts Procurement", description: "Battery tray extrusion 6061-T6", unit: "ea", p50Cents: 6_450, p90Cents: 7_100 },
  { itemCode: "INFL-HSG-STMP", category: "Direct Parts Procurement", description: "Stamped inflator housing", unit: "ea", p50Cents: 1_175, p90Cents: 1_320 },
  { itemCode: "FAST-M10-109", category: "Direct Parts Procurement", description: "Flange bolt M10 Class 10.9 Zn-Ni", unit: "ea", p50Cents: 42, p90Cents: 49 },
  { itemCode: "CONN-HARN-12P", category: "Direct Parts Procurement", description: "Wiring-harness connector 12-pin sealed", unit: "ea", p50Cents: 185, p90Cents: 214 },
  { itemCode: "PRET-RETR-CLIP", category: "Direct Parts Procurement", description: "Pretensioner retractor clip", unit: "ea", p50Cents: 96, p90Cents: 112 },
  { itemCode: "DIE-INSERT-PG", category: "Tooling & Dies", description: "Progressive die insert", unit: "ea", p50Cents: 1_850_000, p90Cents: 2_100_000 },
  { itemCode: "SVC-DIE-REFURB", category: "Tooling & Dies", description: "Die refurbishment labor hour", unit: "hr", p50Cents: 12_500, p90Cents: 14_200 },
  { itemCode: "TOOL-INJ-SCREW", category: "Tooling & Dies", description: "Injection-molding screw & barrel rebuild", unit: "ea", p50Cents: 1_480_000, p90Cents: 1_690_000 },
  { itemCode: "RC-CTRL-KIT", category: "MRO & Equipment Repair", description: "Robot controller upgrade kit", unit: "kit", p50Cents: 2_250_000, p90Cents: 2_480_000 },
  { itemCode: "SVC-INTEG-HR", category: "MRO & Equipment Repair", description: "Integration labor hour", unit: "hr", p50Cents: 18_500, p90Cents: 21_000 },
  { itemCode: "ROBOT-PM-6AX", category: "MRO & Equipment Repair", description: "Robot preventive maintenance, 6-axis", unit: "ea", p50Cents: 420_000, p90Cents: 470_000 },
  { itemCode: "HYD-OIL-46", category: "MRO & Equipment Repair", description: "Press hydraulic oil ISO VG 46, 55 gal", unit: "drum", p50Cents: 69_000, p90Cents: 78_000 },
  { itemCode: "FORK-BATT-48V", category: "MRO & Equipment Repair", description: "Forklift battery 48V", unit: "ea", p50Cents: 690_000, p90Cents: 760_000 },
  { itemCode: "CMM-CAL", category: "MRO & Equipment Repair", description: "CMM calibration with ISO 17025 cert", unit: "ea", p50Cents: 385_000, p90Cents: 430_000 },
  { itemCode: "SVC-MAINT-HR", category: "MRO & Equipment Repair", description: "Millwright labor hour", unit: "hr", p50Cents: 9_500, p90Cents: 11_000 },
  { itemCode: "CAE-SEAT-LIC", category: "Professional Services & Software", description: "CAE seat license, annual", unit: "seat", p50Cents: 420_000, p90Cents: 465_000 },
  { itemCode: "SVC-FEA-HR", category: "Professional Services & Software", description: "Crash simulation engineering hour", unit: "hr", p50Cents: 16_500, p90Cents: 19_000 },
  { itemCode: "PPAP-LAB", category: "Professional Services & Software", description: "PPAP lab material certification", unit: "ea", p50Cents: 280_000, p90Cents: 320_000 },
  { itemCode: "CONT-SORT-HR", category: "Warranty & Containment", description: "Containment sorting hour (CS1)", unit: "hr", p50Cents: 4_800, p90Cents: 5_600 },
];

export const PLANTS = {
  auburnHills: { plant: "Auburn Hills HQ & R&D Center", address: "2600 Featherstone Rd, Auburn Hills, MI" },
  toledo: { plant: "Toledo Seatbelt Plant — Line B", address: "4100 Bennett Rd, Toledo, OH" },
  chattanooga: { plant: "Chattanooga Airbag Module Plant", address: "7200 Bonny Oaks Dr, Chattanooga, TN" },
  sanAntonio: { plant: "San Antonio Electronics Plant", address: "9500 Ray Ellison Blvd, San Antonio, TX" },
  romeo: { plant: "Midwest Proving Grounds — Track 3", address: "71000 Van Dyke Rd, Romeo, MI" },
  laredo: { plant: "Laredo Cross-Dock (Monterrey supply)", address: "11300 Mines Rd, Laredo, TX" },
} as const;

export const APPROVERS: Record<string, string[]> = {
  Manager: ["K. Alvarez", "M. Greene", "T. Nguyen"],
  Director: ["D. Whitfield", "S. Okafor"],
  VP: ["R. Castillo", "L. Moreno"],
  CFO: ["J. Harrington"],
};
