import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { Extraction } from "@/lib/domain/schemas";
import { CRITICAL_GROUNDED_FIELDS, GROUNDED_FIELDS, checkField, groundExtraction, identifierInText, moneyInText } from "@/lib/ai/grounding";
import { loadFixture } from "@/lib/ai/ocr";

// OCR grounding (DECISIONS D-37). The 130 seeded fixtures only prove grounding does not false-alarm on clean
// data; the mutation table is what gives it recall coverage. Neither is a benchmark (see D-37, task D).

afterAll(() => prisma.$disconnect());

describe("no false alarms on the seeded fixtures", () => {
  it("every non-null field of all 130 seeded extractions is found in its own OCR text", async () => {
    const claims = await prisma.claim.findMany({ where: { source: "seed" }, select: { claimId: true }, orderBy: { claimId: "asc" } });
    expect(claims.length).toBe(130);
    const notFound: string[] = [];
    let checked = 0;
    for (const { claimId } of claims) {
      const fixture = await loadFixture(claimId);
      expect(fixture, claimId).not.toBeNull();
      const checks = groundExtraction(fixture!.extraction, fixture!.ocrText);
      for (const f of GROUNDED_FIELDS) {
        if (checks[f] === "not_found") notFound.push(`${claimId}.${f}`);
        if (checks[f] !== "not_extracted") checked++;
      }
    }
    expect(notFound).toEqual([]);
    expect(checked).toBeGreaterThan(130 * 5);
  });
});

describe("mutations on CLM-2026-0144 (critical field × change a character / change the format / null)", async () => {
  const fixture = (await loadFixture("CLM-2026-0144"))!;
  const base = fixture.extraction;
  const text = fixture.ocrText;
  const withValue = (field: string, value: unknown): Extraction =>
    field === "vendorName" ? { ...base, vendor: { ...base.vendor, name: value as string | null } } : ({ ...base, [field]: value } as Extraction);

  type Case = [field: (typeof CRITICAL_GROUNDED_FIELDS)[number], corruption: string, extraction: Extraction, ocrText: string, expected: string];
  const cases: Case[] = [
    // change a character → the altered value is not in the text
    ["vendorName", "change a character", withValue("vendorName", "Lone Star Robotix Integration"), text, "not_found"],
    ["invoiceNumber", "change a digit", withValue("invoiceNumber", "LSRI-2026-0418"), text, "not_found"],
    ["invoiceDate", "change a digit", withValue("invoiceDate", "2026-10-22"), text, "not_found"],
    ["poNumber", "change a digit", withValue("poNumber", "4500872"), text, "not_found"],
    ["total", "change a digit", withValue("total", 56900), text, "not_found"],
    // change the format → same value, different spelling: must still be found (no false alarm)
    ["vendorName", "change the format", withValue("vendorName", "Lone Star Robotics Integration, L.L.C."), text, "found"],
    ["invoiceNumber", "change the format", withValue("invoiceNumber", "lsri 2026 0417"), text, "found"],
    ["invoiceDate", "change the format (text says Oct 21, 2026)", base, text.replace("Invoice Date: 2026-10-21", "Invoice Date: Oct 21, 2026"), "found"],
    ["poNumber", "change the format", withValue("poNumber", "4500-871"), text, "found"],
    ["total", "change the format (text says 56800.00 USD)", base, text.replace("TOTAL DUE (USD): $56,800.00", "TOTAL DUE: 56800.00 USD"), "found"],
    // set to null → not_extracted, never not_found (B1)
    ["vendorName", "null", withValue("vendorName", null), text, "not_extracted"],
    ["invoiceNumber", "null", withValue("invoiceNumber", null), text, "not_extracted"],
    ["invoiceDate", "null", withValue("invoiceDate", null), text, "not_extracted"],
    ["poNumber", "null", withValue("poNumber", null), text, "not_extracted"],
    ["total", "null", withValue("total", null), text, "not_extracted"],
  ];
  it.each(cases)("%s · %s → %s", (field, _corruption, extraction, ocrText, expected) => {
    expect(checkField(field, extraction, ocrText)).toBe(expected);
  });
});

describe("boundaries and the documented hard limit", () => {
  it("an id is not found inside a longer number or an amount", () => {
    expect(identifierInText("4500871", "Total $45,008.71")).toBe(false);
    expect(identifierInText("4500871", "PO 45008712")).toBe(false);
    expect(identifierInText("4500871", "PO Number: 4500871")).toBe(true);
  });
  it("money parsing reads grouped, plain and zero amounts", () => {
    expect([...moneyInText("Subtotal: $55,200.00 Tax $0.00 Total 56800.00")]).toEqual(expect.arrayContaining([5_520_000, 0, 5_680_000]));
  });
  it("hard limit: a value that IS in the text but in the wrong field (subtotal read as total) is still 'found'", async () => {
    const f = (await loadFixture("CLM-2026-0144"))!;
    expect(checkField("total", { ...f.extraction, total: 55200 }, f.ocrText)).toBe("found");
  });
});
