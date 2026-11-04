# Build plan

- [x] Phase 0: plan, DECISIONS.md
- [x] Phase 1: foundation (Next.js, Tailwind, Prisma schema + migration, domain constants/schemas/money/dates, seed master data, 7 hero + ~123 historical claims, receipts + fixtures, `kpi-report`)
- [x] Phase 2: core workflow (shell, dashboard list, claim review, conditional AI blocks, audit button, audit API + transaction, audit timeline)
- [x] Phase 3: intelligence (OCR adapter, DeepSeek extraction/narrative, deterministic risk rules + tests, SVG annotation, KPI engine, charts, watchlist, URL filters)
- [x] Phase 4: polish (`/audit`, `/policies`, `/claims/new` intake, empty/loading/error states, mobile drawer, accessibility pass)
- [x] Phase 5: verify (lint, typecheck, 47 tests, build, golden path in a browser) and document (README, docs/)
- [x] Phase 6: delivery gaps. Batch 1: AI panels after posting (G-04), posting to SAP (G-03), exception disposition (G-01). Batch 2: env fail-fast (G-31), mock-upload notice (G-38). Batch 3: CI (G-16), screenshots + GIF frames (G-23/G-24)

Key paths: `src/lib/audit/run-audit.ts` (workflow) · `src/lib/risk/` (rules) · `src/lib/ai/` (adapters) · `src/lib/kpi/` (KPIs) · `src/lib/seed/` (data) · `src/app/(app)/` (pages).
