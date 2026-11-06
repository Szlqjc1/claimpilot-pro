// CSV writing for the claim and audit exports (Task 8, 9.4). Pure.
//
// The three ways CSVs go wrong, and what this module does about each:
//   1. Money: a bare decimal ("14500.00"), never "$14,500.00", so a spreadsheet can SUM the column.
//   2. Dates: "YYYY-MM-DD" or "YYYY-MM-DD HH:mm" in UTC (the header says so), never the "Oct 29, 2026 11:40 AM ET"
//      display format, which a spreadsheet reads as text.
//   3. Injection: a text cell starting with = + - @ gets a leading ' so a spreadsheet does not run it as a formula;
//      cells containing , " CR or LF are quoted with embedded quotes doubled (RFC 4180).
//
// No UTF-8 BOM is written. Every column is ASCII-safe data (ids, names, ISO dates, bare decimals), and a BOM would
// glue itself to the first header cell for tools that do not strip it ("﻿claim_id").

export const EXPORT_ROW_CAP = 10_000;
export const truncationNote = (cap: number) => `# truncated at ${cap} rows, narrow the filters`;

const FORMULA_START = /^[=+\-@]/;

export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  // Numbers are data the export produced itself, never user text: no formula guard (a negative number stays numeric).
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  let s = value;
  if (FORMULA_START.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: (string | number | null)[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** Integer cents → bare decimal with two places. */
export const csvMoney = (cents: number) => (cents / 100).toFixed(2);
/** UTC calendar date. */
export const csvDate = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
/** UTC timestamp to the minute. */
export const csvDateTime = (d: Date | null | undefined) => (d ? `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)}` : null);

/** Rows plus, when the query returned more than `cap`, a final note row. Pass `cap + 1` as the query limit. */
export function capRows(rows: (string | number | null)[][], cap: number): (string | number | null)[][] {
  return rows.length > cap ? [...rows.slice(0, cap), [truncationNote(cap)]] : rows;
}

export function csvHeaders(filename: string): HeadersInit {
  return { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" };
}
