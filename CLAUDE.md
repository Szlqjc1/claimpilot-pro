# CLAUDE.md

ClaimPilot PRO: a Next.js 15 + Prisma/SQLite AI-RPA expense-review demo (fictional US automotive supplier, USD only).

## Commands
- `pnpm dev` · `pnpm build` · `pnpm lint` · `pnpm typecheck` · `pnpm test`
- `pnpm db:seed` wipes and reseeds the demo (asserts hero risk results). `pnpm kpi:report` checks KPI target ranges.
- Tests use their own DB (`prisma/test.db`) and receipts dir (`storage-test/`), both set in `vitest.config.ts`.

## Invariants (do not break)
- Exact strings: button `🚀 Run AI-RPA Audit`; H1 `AI-RPA Automotive Expense Inspection`; label `Original OEM/Supplier Invoice`; clean audit entry `AI-RPA Agent` / `Automotive Expense Validated` / `Invoice matched with SAP project code successfully.` (zero findings only).
- AI Structured Data + AI-Annotated Invoice are conditionally rendered only when `status === "Analyzed"`.
- Risk scoring (`src/lib/risk`) is pure and deterministic; the LLM never sets the score. Hero results are in `src/tests/risk.test.ts`; fix rules or seed, not the test.
- Mapped column names on `Claims`, `Exceptions`, `AuditLog` must stay exact. The audit log is append-only.
- Money: Prisma Decimal in the DB, integer cents in code (`toCents`). Store UTC, display ET.
- DeepSeek only from `server-only` modules; text only (OCR first).
- Record spec deviations in `DECISIONS.md`.
