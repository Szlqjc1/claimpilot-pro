import { describe, expect, it } from "vitest";
import { buildSeedPlan, seedRiskInput } from "@/lib/seed/run";
import { evaluateRisk } from "@/lib/risk/score";
import { groundExtraction } from "@/lib/ai/grounding";
import { CRITICAL_FIELDS, FIELD_LABEL_ALIASES, labelExplicitlyEmpty, labelPresent } from "@/lib/ai/labels";
import { classifyPresence, presenceOf, type FieldPresence } from "@/lib/ai/presence";
import { isRequired } from "@/lib/domain/field-policy";
import { presenceChipFor } from "@/lib/domain/fields";
import { extractionSchema } from "@/lib/domain/schemas";
import type { CriticalField } from "@/lib/ai/labels";
import type { RiskInput } from "@/lib/risk/types";

// Field presence, the required/optional policy and R-19 (Task 13 Part A, DECISIONS D-44).

const plan = buildSeedPlan();
const textOf = (id: string) => plan.fixtures.get(id)!.fixture.ocrText;
const inputFor = (id: string) => seedRiskInput(plan, plan.claims.find((c) => c.claimId === id)!);

/** Grounding and presence attached before scoring, exactly as run-audit does. */
function withPresence(input: RiskInput, text: string): RiskInput {
  const withChecks = { ...input.extraction, fieldChecks: groundExtraction(input.extraction, text) };
  return { ...input, extraction: { ...withChecks, fieldPresence: presenceOf(withChecks, text) } };
}
const finding = (input: RiskInput, ruleId: string) => evaluateRisk(input).findings.find((f) => f.ruleId === ruleId) ?? null;
const presence = (over: Partial<Record<CriticalField, FieldPresence["state"]>>) =>
  Object.fromEntries(CRITICAL_FIELDS.map((f) => [f, { field: f, state: over[f] ?? "present", labelSeen: true }]));

describe("labelPresent (A1)", () => {
  it.each([
    ["invoiceNumber", "Inv. #: 4471"],
    ["invoiceNumber", "INVOICE NUMBER 4471"],
    ["invoiceNumber", "Invoice–No. 4471"],
    ["invoiceNumber", "发票号：4471"],
    ["invoiceNumber", "单 据 号 4471"],
    ["invoiceDate", "Issue Date 2026-10-01"],
    ["invoiceDate", "开票日期：2026-10-01"],
    ["poNumber", "P.O. 4500012345"],
    ["poNumber", "Purchase  Order: 4500012345"],
    ["poNumber", "采购订单 4500012345"],
    ["total", "Balance Due $1,200.00"],
    ["total", "合计 1200.00"],
    ["vendorName", "Remit-To: Acme"],
    ["vendorName", "供应商：Acme"],
  ] as const)("%s in %j", (field, text) => {
    expect(labelPresent(field, text)).toBe(true);
  });

  it("matches on word boundaries only", () => {
    expect(labelPresent("poNumber", "Reorder note: expedite")).toBe(false); // "order no" inside "reorder note"
    expect(labelPresent("total", "Subtotals were checked")).toBe(false);
    expect(labelPresent("vendorName", "Fromage plate")).toBe(false);
    expect(labelPresent("invoiceNumber", "Payment terms: Net 60")).toBe(false);
  });

  it("every field has its aliases", () => {
    expect(Object.keys(FIELD_LABEL_ALIASES).sort()).toEqual([...CRITICAL_FIELDS].sort());
  });

  it("a label followed only by an empty marker says the field is empty", () => {
    expect(labelExplicitlyEmpty("poNumber", "PO Number: —\nRelease: —")).toBe(true);
    expect(labelExplicitlyEmpty("poNumber", "PO No.: N/A")).toBe(true);
    expect(labelExplicitlyEmpty("poNumber", "PO Number:\nRelease: 4")).toBe(false); // blank: OCR may have dropped it
    expect(labelExplicitlyEmpty("poNumber", "PO Number | – | Release")).toBe(true);
    expect(labelExplicitlyEmpty("poNumber", "PO Number: 45-00012345")).toBe(false);
    // OCR flattens a table row into spaces (D-45): the dash is still the PO's value.
    expect(labelExplicitlyEmpty("poNumber", "PO Number: — Release: —")).toBe(true);
    // The label's value printed on another line, detached from it: not a statement, so not "empty".
    expect(labelExplicitlyEmpty("poNumber", "PO Number Release\n— —")).toBe(false);
    expect(labelExplicitlyEmpty("poNumber", "PO Number: 4500012345")).toBe(false);
    expect(labelExplicitlyEmpty("poNumber", "PO Number: —\nPurchase Order 4500012345")).toBe(false);
    expect(labelExplicitlyEmpty("poNumber", "Ship To: Toledo")).toBe(false);
  });
});

describe("classifyPresence (A2): the five branches", () => {
  const base = { field: "invoiceNumber" as const, text: "Invoice No.: TVR-118\nTOTAL DUE: $10.00" };

  it("1. two distinct candidate values → conflict (before anything else)", () => {
    expect(classifyPresence({ ...base, value: "TVR-118", grounding: "found", candidateValues: ["TVR-118", "TVR-181"] }).state).toBe("conflict");
    // Same value written two ways is not a conflict.
    expect(classifyPresence({ ...base, value: "TVR-118", grounding: "found", candidateValues: ["TVR-118", "tvr 118"] }).state).toBe("present");
    expect(classifyPresence({ ...base, field: "total", value: "10", grounding: "found", candidateValues: ["$10.00", "10"] }).state).toBe("present");
  });

  it("2. value and grounding found → present", () => {
    expect(classifyPresence({ ...base, value: "TVR-118", grounding: "found" })).toEqual({ field: "invoiceNumber", state: "present", labelSeen: true });
  });

  it("3. value the document does not contain → unreadable", () => {
    expect(classifyPresence({ ...base, value: "TVR-999", grounding: "not_found" }).state).toBe("unreadable");
  });

  it("4. no value but the label is there → unreadable (including a Chinese label)", () => {
    expect(classifyPresence({ ...base, value: null, grounding: "not_extracted" }).state).toBe("unreadable");
    expect(classifyPresence({ field: "poNumber", value: null, grounding: "not_extracted", text: "采购订单： 45#0?12" })).toEqual({ field: "poNumber", state: "unreadable", labelSeen: true });
  });

  it("5. no value and no label → absent; a label with an empty marker → absent", () => {
    expect(classifyPresence({ field: "poNumber", value: null, grounding: "not_extracted", text: "Hotel folio\nTotal $10" })).toEqual({ field: "poNumber", state: "absent", labelSeen: false });
    expect(classifyPresence({ field: "poNumber", value: null, grounding: "not_extracted", text: "PO Number: —" })).toEqual({ field: "poNumber", state: "absent", labelSeen: true });
  });
});

describe("isRequired (A3)", () => {
  it("vendor, invoice number, date and total are always required", () => {
    for (const f of ["vendorName", "invoiceNumber", "invoiceDate", "total"] as const) expect(isRequired(f, { amountCents: 100, category: "Client Entertainment" })).toBe(true);
  });

  it("PO: required from $1,000 for procurement, on both sides of the line", () => {
    expect(isRequired("poNumber", { amountCents: 99_999, category: "Direct Parts Procurement" })).toBe(false);
    expect(isRequired("poNumber", { amountCents: 100_000, category: "Direct Parts Procurement" })).toBe(true);
    expect(isRequired("poNumber", { amountCents: 5_000_000, category: "Tooling & Dies" })).toBe(true);
  });

  it("a $3,000 Client Entertainment (or Supplier Audit Travel) claim never requires a PO", () => {
    expect(isRequired("poNumber", { amountCents: 300_000, category: "Client Entertainment" })).toBe(false);
    expect(isRequired("poNumber", { amountCents: 300_000, category: "Supplier Audit Travel" })).toBe(false);
  });
});

describe("R-19 (A4)", () => {
  const procurement = inputFor("CLM-2026-0142"); // $14,500 R&D Track Testing, clean
  const scored = (over: Partial<Record<CriticalField, FieldPresence["state"]>>, input: RiskInput = procurement) =>
    evaluateRisk({ ...input, extraction: { ...input.extraction, fieldPresence: presence(over) } });

  it("fires, 20 points High, on a missing required field", () => {
    const f = scored({ poNumber: "absent" }).findings.find((x) => x.ruleId === "R-19")!;
    expect(f).toMatchObject({ points: 20, riskLevel: "High", anomalyType: "Incomplete or Conflicting Extraction", evidence: { missing: ["poNumber"] } });
    expect(f.message).toBe("Required field missing from the invoice: poNumber. Obtain a complete invoice before posting.");
    expect(scored({ poNumber: "absent" })).toMatchObject({ score: 20, riskLevel: "High", decision: "ESCALATE" });
    expect(scored({ invoiceNumber: "absent" }).findings.map((x) => x.ruleId)).toContain("R-19");
  });

  it("fires on a conflicting value", () => {
    const input = { ...procurement, extraction: { ...procurement.extraction, fieldCandidates: { total: ["14500.00", "15400.00"] } } };
    const f = scored({ total: "conflict" }, input).findings.find((x) => x.ruleId === "R-19")!;
    expect(f.evidence).toEqual({ conflicting: { total: ["14500.00", "15400.00"] } });
    expect(f.message).toBe("The invoice gives conflicting values for total. Obtain a complete invoice before posting.");
  });

  it("does not fire on an absent optional field or on unreadable", () => {
    expect(finding({ ...inputFor("CLM-2026-0147"), extraction: { ...inputFor("CLM-2026-0147").extraction, fieldPresence: presence({ poNumber: "absent" }) } }, "R-19")).toBeNull();
    expect(scored({ invoiceNumber: "unreadable" }).findings.map((x) => x.ruleId)).not.toContain("R-19");
    expect(scored({}).findings).toEqual([]);
  });

  it("without presence attached (seeded scoring) it never fires", () => {
    expect(finding(procurement, "R-19")).toBeNull();
  });

  it("synthetic upload: a $14,500 procurement invoice with no PO line escalates on R-19", () => {
    const text = textOf("CLM-2026-0142").split("\n").filter((l) => !/^PO Number/.test(l)).join("\n");
    const input = withPresence({ ...procurement, claim: { ...procurement.claim, poNumber: null }, po: null, extraction: { ...procurement.extraction, poNumber: null } }, text);
    expect(input.extraction.fieldPresence?.poNumber.state).toBe("absent");
    expect(finding(input, "R-19")).toMatchObject({ points: 20, evidence: { missing: ["poNumber"] } });
    expect(evaluateRisk(input).decision).toBe("ESCALATE");
  });
});

describe("R-14 routes unreadable (A4)", () => {
  const procurement = inputFor("CLM-2026-0142");

  it("a label with no value fires R-14 with the rescan message, not R-19", () => {
    const text = textOf("CLM-2026-0142").replace(/^Invoice No\.:.*$/m, "Invoice No.: ");
    const input = withPresence({ ...procurement, extraction: { ...procurement.extraction, invoiceNumber: null } }, text);
    expect(input.extraction.fieldPresence?.invoiceNumber.state).toBe("unreadable");
    const f = finding(input, "R-14")!;
    expect(f).toMatchObject({ points: 15, riskLevel: "Low", evidence: { labelWithoutValue: ["invoiceNumber"] } });
    expect(f.message).toBe("Scan too poor to verify invoiceNumber — rescan or check this field manually.");
    expect(finding(input, "R-19")).toBeNull();
  });

  it("a label with no value on an OPTIONAL field fires nothing (a travel PO whose dash OCR detached)", () => {
    const travel = inputFor("CLM-2026-0147");
    const text = textOf("CLM-2026-0147").replace(/^PO Number: —$/m, "PO Number");
    const input = withPresence(travel, text);
    expect(input.extraction.fieldPresence?.poNumber.state).toBe("unreadable");
    expect(finding(input, "R-14")).toBeNull();
    expect(finding(input, "R-19")).toBeNull();
    expect(evaluateRisk(input)).toMatchObject({ score: 50, decision: "REVIEW" });
  });

  it("an ungrounded value keeps its R-14 trigger, with the new message", () => {
    const input = withPresence({ ...procurement, extraction: { ...procurement.extraction, invoiceNumber: "XX-0000", total: 99.99 } }, textOf("CLM-2026-0142"));
    const f = finding(input, "R-14")!;
    expect(f.points).toBe(30);
    expect(f.message).toBe("Scan too poor to verify invoiceNumber, total — rescan or check these fields manually.");
  });
});

describe("A6: every seeded claim", () => {
  it("all five critical fields are present, except a PO the invoice states it has none of, where none is required", () => {
    expect(plan.claims).toHaveLength(130);
    const absentPo: string[] = [];
    for (const c of plan.claims) {
      const input = withPresence(seedRiskInput(plan, c), textOf(c.claimId));
      for (const f of CRITICAL_FIELDS) {
        const state = input.extraction.fieldPresence![f].state;
        if (f === "poNumber" && state === "absent") {
          absentPo.push(c.claimId);
          expect(isRequired(f, input.claim), c.claimId).toBe(false);
        } else expect(state, `${c.claimId}.${f}`).toBe("present");
      }
    }
    expect(absentPo).toHaveLength(15);
    expect(new Set(absentPo.map((id) => plan.claims.find((c) => c.claimId === id)!.category))).toEqual(new Set(["Supplier Audit Travel", "Client Entertainment"]));
  });

  it("scoring with presence attached changes nothing: R-19 never fires, every result is identical", () => {
    for (const c of plan.claims) {
      const base = seedRiskInput(plan, c);
      const withChecks = { ...base, extraction: { ...base.extraction, fieldChecks: groundExtraction(base.extraction, textOf(c.claimId)) } };
      const full = withPresence(base, textOf(c.claimId));
      expect(finding(full, "R-19"), c.claimId).toBeNull();
      expect(evaluateRisk(full), c.claimId).toEqual(evaluateRisk(withChecks));
    }
  });

  it.each([
    ["CLM-2026-0142", 0, "AUTO_APPROVE"],
    ["CLM-2026-0144", 100, "ESCALATE"],
    ["CLM-2026-0146", 65, "ESCALATE"],
    ["CLM-2026-0147", 50, "REVIEW"],
  ] as const)("hero %s keeps %i / %s with presence attached", (id, score, decision) => {
    expect(evaluateRisk(withPresence(inputFor(id), textOf(id)))).toMatchObject({ score, decision });
  });
});

describe("A5: schema and chips", () => {
  it("otherFields defaults to [] and round-trips", () => {
    const e = plan.fixtures.get("CLM-2026-0142")!.fixture.extraction;
    expect(extractionSchema.parse({ ...e, otherFields: undefined }).otherFields).toEqual([]);
    expect(extractionSchema.parse({ ...e, otherFields: [{ label: "Carrier", value: "Penske" }] }).otherFields).toEqual([{ label: "Carrier", value: "Penske" }]);
  });

  it.each([
    ["present", "found", 0.96, "✓ found · OCR 0.96"],
    ["unreadable", "not_found", 0.96, "✗ not found · OCR 0.96"],
    ["unreadable", "not_extracted", undefined, "✗ not found · label, no value"],
    ["absent", "not_extracted", undefined, "— absent"],
    ["conflict", "found", 0.96, "≠ conflict"],
  ] as const)("%s / %s → %s", (state, check, ocr, text) => {
    expect(presenceChipFor(state, check, ocr).text).toBe(text);
  });
});
