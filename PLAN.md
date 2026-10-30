# Build plan

- [x] Phase 0: plan, DECISIONS.md
- [x] Phase 1: foundation (Next.js, Tailwind, Prisma schema + migration, domain constants/schemas/money/dates, seed master data, 7 hero + ~123 historical claims, receipts + fixtures, `kpi-report`)
- [x] Phase 2: core workflow (shell, dashboard list, claim review, conditional AI blocks, audit button, audit API + transaction, audit timeline)
- [x] Phase 3: intelligence (OCR adapter, DeepSeek extraction/narrative, deterministic risk rules + tests, SVG annotation, KPI engine, charts, watchlist, URL filters)
- [x] Phase 4: polish (`/audit`, `/policies`, `/claims/new` intake, empty/loading/error states, mobile drawer, accessibility pass)
- [x] Phase 5: verify (lint, typecheck, 47 tests, build, golden path in a browser) and document (README, docs/)

Key paths: `src/lib/audit/run-audit.ts` (workflow) · `src/lib/risk/` (rules) · `src/lib/ai/` (adapters) · `src/lib/kpi/` (KPIs) · `src/lib/seed/` (data) · `src/app/(app)/` (pages).
