import { afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import type { SessionUser } from "@/lib/auth/session";
import { capRows, csvCell, csvDate, csvDateTime, csvMoney, toCsv, truncationNote } from "@/lib/export/csv";

// CSV export (Task 8, 9.4): escaping, injection guard, machine-readable money and dates, routes, truncation.

let current: SessionUser | null = { id: "U-CSV", name: "CSV Test Reviewer", email: "csv@test.example", role: "reviewer" };
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  requireUser: async () => current,
}));

const { GET: claimsExport } = await import("@/app/api/claims/export/route");
const { GET: auditExport } = await import("@/app/api/audit/export/route");
const { claimsCsv, auditCsv, CLAIM_COLUMNS } = await import("@/lib/export/exports");
const { getClaimsPage } = await import("@/lib/kpi/queries");
const { claimFiltersSchema } = await import("@/lib/domain/schemas");

afterAll(() => prisma.$disconnect());

/** Minimal RFC 4180 reader for the assertions (handles quoted commas, quotes and newlines). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\r" && text[i + 1] === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i++;
    } else cell += ch;
  }
  if (cell || row.length) rows.push([...row, cell]);
  return rows;
}

describe("csvCell", () => {
  it.each([
    ["plain", "plain"],
    ["a,b", '"a,b"'],
    ['say "hi"', '"say ""hi"""'],
    ["line1\nline2", '"line1\nline2"'],
    ["cr\rhere", '"cr\rhere"'],
    ["=cmd|' /C calc'!A0", "'=cmd|' /C calc'!A0"],
    ["+1", "'+1"],
    ["-1", "'-1"],
    ["@x", "'@x"],
    ["=1,2", `"'=1,2"`],
  ] as const)("%j → %j", (input, expected) => {
    expect(csvCell(input)).toBe(expected);
  });

  it("null/undefined are empty, numbers stay numeric (no formula guard on a negative number)", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(-5)).toBe("-5");
    expect(csvCell(100)).toBe("100");
  });

  it("toCsv writes CRLF rows and no byte-order mark", () => {
    const out = toCsv(["a", "b"], [["1", 2], [null, "x,y"]]);
    expect(out).toBe('a,b\r\n1,2\r\n,"x,y"\r\n');
    expect(out.charCodeAt(0)).not.toBe(0xfeff);
  });
});

describe("money and dates are machine-readable", () => {
  it("money is a bare decimal with two places, never $ or a thousands separator", () => {
    expect(csvMoney(1_450_000)).toBe("14500.00");
    expect(csvMoney(5)).toBe("0.05");
    expect(csvMoney(12_345_678_901)).toBe("123456789.01");
    for (const c of [0, 99, 1_450_000, 98_765_432]) expect(csvMoney(c)).toMatch(/^\d+\.\d{2}$/);
  });

  it("dates are YYYY-MM-DD and timestamps YYYY-MM-DD HH:mm in UTC", () => {
    const d = new Date("2026-10-29T15:40:00Z");
    expect(csvDate(d)).toBe("2026-10-29");
    expect(csvDateTime(d)).toBe("2026-10-29 15:40");
    expect(csvDateTime(null)).toBeNull();
  });
});

describe("GET /api/claims/export and /api/audit/export", () => {
  const req = (path: string) => new Request(`http://localhost${path}`);

  it("401 without a session", async () => {
    const saved = current;
    current = null;
    try {
      expect((await claimsExport(req("/api/claims/export"))).status).toBe(401);
      expect((await auditExport(req("/api/audit/export"))).status).toBe(401);
    } finally {
      current = saved;
    }
  });

  it("200 with a session: CSV headers, no BOM, and one row per claim the /claims list selects (all pages)", async () => {
    for (const qs of ["", "?department=Plant%20Operations&range=12m", "?status=Posted&risk=Low"]) {
      const res = await claimsExport(req(`/api/claims/export${qs}`));
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
      expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="claims-\d{4}-\d{2}-\d{2}\.csv"$/);
      expect(res.headers.get("cache-control")).toBe("no-store");
      const text = await res.text();
      expect(text.charCodeAt(0)).not.toBe(0xfeff);
      const rows = parseCsv(text);
      expect(rows[0]).toEqual(CLAIM_COLUMNS);
      const list = await getClaimsPage(claimFiltersSchema.parse(Object.fromEntries(new URLSearchParams(qs))));
      expect(rows.length - 1).toBe(list.total);
      // Amount column: bare decimals only; date columns: UTC timestamps.
      for (const r of rows.slice(1)) {
        expect(r[8]).toMatch(/^\d+\.\d{2}$/);
        expect(r[14]).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
      }
    }
  });

  it("the audit export honours its filters and uses UTC timestamps", async () => {
    const res = await auditExport(req("/api/audit/export?action=Claim%20Submitted"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(/filename="audit-log-\d{4}-\d{2}-\d{2}\.csv"/);
    const rows = parseCsv(await res.text());
    expect(rows[0]).toEqual(["timestamp_utc", "actor", "action", "claim_id", "details"]);
    expect(rows.length - 1).toBe(await prisma.auditLog.count({ where: { action: "Claim Submitted" } }));
    expect(rows.slice(1).every((r) => r[2] === "Claim Submitted" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(r[0]))).toBe(true);
  });
});

describe("truncation at the cap", () => {
  it("adds a final note row when the result set exceeds the cap (small injected cap)", async () => {
    const filters = claimFiltersSchema.parse({});
    const out = await claimsCsv(filters, 5);
    const rows = parseCsv(out.csv);
    expect(out).toMatchObject({ rows: 5, truncated: true });
    expect(rows).toHaveLength(1 + 5 + 1);
    expect(rows.at(-1)).toEqual([truncationNote(5)]);
    const audit = await auditCsv({ page: 1 }, 3);
    expect(parseCsv(audit.csv).at(-1)).toEqual([truncationNote(3)]);
  });

  it("no note when the result fits", () => {
    expect(capRows([["a"], ["b"]], 2)).toEqual([["a"], ["b"]]);
    expect(capRows([["a"], ["b"], ["c"]], 2)).toEqual([["a"], ["b"], ["# truncated at 2 rows, narrow the filters"]]);
  });
});
