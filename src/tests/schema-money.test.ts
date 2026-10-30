import { describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { normalizeExtraction, parseExtractedData } from "@/lib/domain/schemas";
import { centsToDecimalString, formatUsd, toCents } from "@/lib/domain/money";
import { stripFences } from "@/lib/ai/deepseek";
import { buildSeedPlan } from "@/lib/seed/run";
import { sniffMime } from "@/lib/receipts/storage";

const plan = buildSeedPlan();
const fixture = plan.fixtures.get("CLM-2026-0146")!.fixture;

describe("extraction schema", () => {
  it("seeded fixtures validate and reconcile to the claim amount", () => {
    for (const { fixture: f } of plan.fixtures.values()) {
      const e = normalizeExtraction(f.extraction);
      expect(e.warnings).toEqual([]);
      expect(e.boundingBoxes.length).toBeGreaterThan(0);
    }
    expect(fixture.extraction.total).toBe(18_750);
    expect(fixture.extraction.salesTax).toBe(1_061.32);
  });
  it("adds a warning when totals do not reconcile", () => {
    const bad = normalizeExtraction({ ...fixture.extraction, total: 18_900 });
    expect(bad.warnings.some((w) => w.includes("do not reconcile"))).toBe(true);
  });
  it("rejects malformed dates and confidences", () => {
    expect(() => normalizeExtraction({ ...fixture.extraction, invoiceDate: "10/22/2026" })).toThrow();
    expect(() => normalizeExtraction({ ...fixture.extraction, fieldConfidence: { total: 1.4 } })).toThrow();
  });
  it("parses Extracted_Data safely", () => {
    expect(parseExtractedData(null)).toBeNull();
    expect(parseExtractedData("{not json")).toMatchObject({ ok: false });
    expect(parseExtractedData('{"total": 1}')).toMatchObject({ ok: false });
    expect(parseExtractedData(JSON.stringify(fixture.extraction))).toMatchObject({ ok: true });
  });
  it("strips Markdown fences from model output", () => {
    expect(stripFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });
});

describe("money", () => {
  it("converts decimals to integer cents without float drift", () => {
    expect(toCents("2451.57")).toBe(245_157);
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents("17688.675")).toBe(1_768_868);
    expect(centsToDecimalString(245_157)).toBe("2451.57");
    expect(centsToDecimalString(-5)).toBe("-0.05");
    expect(formatUsd(5_680_000)).toBe("$56,800.00");
  });
  it("round-trips Prisma Decimal through SQLite exactly", async () => {
    const prisma = new PrismaClient();
    try {
      const rows = await prisma.claim.findMany({ where: { claimId: { in: ["CLM-2026-0146", "CLM-2026-0147"] } }, orderBy: { claimId: "asc" } });
      expect(rows.map((r) => toCents(r.amount))).toEqual([1_875_000, 245_157]);
      const sum = rows.reduce((s, r) => s + toCents(r.amount), 0);
      expect(sum).toBe(2_120_157);
    } finally {
      await prisma.$disconnect();
    }
  });
});

describe("upload sniffing", () => {
  it("detects by magic bytes, not extension", () => {
    expect(sniffMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("image/png");
    expect(sniffMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffMime(Buffer.from("%PDF-1.7"))).toBe("application/pdf");
    expect(sniffMime(Buffer.from("<svg onload=alert(1)>"))).toBeNull();
  });
});
