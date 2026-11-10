# Submission index

A map for graders who will not read the code: every requirement, decision and known limitation, where it lives
(`file:line`), and how to check it (a click path or a command). Line numbers are for the commit this file ships
with.

## Run it

```bash
pnpm install      # first run: about 7 minutes; no API key needed
pnpm db:reset     # about 3 s: 130 demo claims, 3 users, 130 receipts
pnpm dev          # http://localhost:3000
```

Sign in at `http://localhost:3000` (not `127.0.0.1`) as the reviewer **`priya.natarajan@ironwood.example` /
`Toledo-Controller-26`**. All three demo accounts are listed on the sign-in page. Everything runs offline in mock AI
mode.

## Headline evidence

| Evidence | Where | How to verify |
|---|---|---|
| 393 automated tests (unit + integration against a real SQLite DB) | `src/tests/` (34 files) | `pnpm test` → "Tests 393 passed" |
| CI runs install, migrate, lint, typecheck, test, build | `.github/workflows/ci.yml:27-35` | GitHub Actions badge at the top of `README.md` |
| Deterministic risk engine: 20 rules (R-01…R-20); 7 hero claims with exact scores | `src/lib/risk/score.ts:28`, `src/tests/risk.test.ts:13` | `pnpm test src/tests/risk.test.ts`; `pnpm db:seed` throws if any hero score drifts (`src/lib/seed/run.ts:130`) |
| KPI targets | `src/lib/kpi/formulas.ts:44`, `scripts/kpi-report.ts` | `pnpm kpi:report` → every row `OK` |
| Grounding benchmark: false alarms **harsh 55.8 %**, **realistic 15.2 % → 12.2 %** after OCR clean-up; 852 injected errors, 69.7 % caught end-to-end | `docs/GROUNDING_BENCH.md`, `scripts/grounding-bench.ts:111` | Read the report; `pnpm bench:grounding` (needs `./eng.traineddata`, ~31 min cold, seconds cached) |
| Extraction variants (labels × layout), live model, 20 docs per axis: layouts 100 % accuracy / 0 % escalation / 0 % error in cleared; labels 98–100 % accuracy, and 4 of 98 auto-cleared documents carried a wrong field (truncated vendor name ×3, OCR digit insertion in a PO ×1); **with R-20, 0 % error in auto-cleared claims on every variant** | [`docs/EXTRACTION_VARIANTS.md`](EXTRACTION_VARIANTS.md), `docs/variants.csv`, `scripts/extraction-variants.ts` | Read the report; `pnpm bench:variants` (needs `AI_MODE=live`, a key and `./eng.traineddata`; exits 0 with a message otherwise; cached re-runs make no model calls) |
| Perspective benchmark with a pre-registered decision rule: phone-photo synthesis (homography, pinhole, desk, uneven light) at pitch/yaw 10/10 and 20/15 vs an oracle rectification with the true corners. Photos: 11–12 of 20 documents lose their correct auto-clear (invoice number breaks first); oracle: 0 of 20. **Recovery 100 % → build corner detection** | [`docs/PERSPECTIVE.md`](PERSPECTIVE.md), `src/lib/bench/perspective.ts`, `src/lib/bench/photo.ts` | Read the report; `pnpm bench:variants` (cached re-runs make no model calls); `src/tests/perspective.test.ts` |
| Typography and capture quality on the same harness: serif / condensed / 8 pt body 99–100 % accuracy (font broke nothing); low contrast 60 % + JPEG q25 100 %; **a one-third shadow escalated 20/20** (the shaded values vanish from the OCR text; a global threshold cannot handle non-uniform light); a mug over the header escalated 20/20. Error in auto-cleared 0 % on all six, through R-20 | [`docs/PERSPECTIVE.md`](PERSPECTIVE.md) → Part B, `src/lib/bench/capture.ts` | Read the report; `pnpm bench:variants` (cached re-runs make no model calls) |
| Illumination normalisation (model-free A/B, 20 docs × 6 capture arms): the shadow arm's critical values found 20 % → 100 %, CER 30.7 % → 3.9 %; live check 20/20 bad → 0/20; no regression on clean, low-contrast, clutter or photo arms | [`docs/ILLUMINATION.md`](ILLUMINATION.md), `src/lib/ai/preprocess.ts` (`normalizeIllumination`), `scripts/illumination-ab.ts` | `pnpm bench:illumination` (model-free; `--live` for the one live check); `src/tests/ocr-metrics.test.ts` |
| Field presence: present / absent / unreadable / conflict per critical field; required-vs-optional policy; R-19 escalates a missing required or conflicting field, R-14 a scan too poor to verify. 0 seeded claims trigger R-19 (seed and KPI output byte-identical) | `src/lib/ai/presence.ts:25`, `src/lib/domain/field-policy.ts`, `src/lib/risk/rules.ts:480`, `docs/RISK_RULES.md` | `pnpm test src/tests/presence.test.ts`; a travel claim such as `/claims/CLM-2026-0071` → PO chip "— absent" |
| Review economics and cost curve (`review ⇔ p·L > c`) | `docs/ECONOMICS.md`, `src/lib/risk/economics.ts:19` | `/economics`; `pnpm cost:curve` |
| Spend by site: five sites from the invoice ship-to plant, travel/entertainment attributed to the submitter's home site and disclosed per row; totals reconcile with Total Claim Spend | `src/lib/locations.ts:70`, `src/lib/kpi/locations.ts:28` | `/dashboard` → Spend by site; `pnpm test src/tests/locations.test.ts` |
| Retrieval-first grounded Q&A with citation check | `docs/AI_GOVERNANCE.md`, `src/lib/ask/answer.ts:79` | `/ask` → click an example; the badge says **Template** in mock mode |
| Accessibility evidence: axe-core on 5 pages (0 violations on all five after the fixes; before/after recorded), measured contrast, keyboard walkthrough including dialog focus return, reflow at 390 px, remaining gaps | `docs/ACCESSIBILITY.md`, `scripts/a11y-audit.ts` | Read; `pnpm dev` + `pnpm a11y:audit` |
| Architecture and AI boundary | `docs/ARCHITECTURE.md`, `docs/AI_GOVERNANCE.md` | Read |
| Demo walkthrough | `docs/DEMO_SCRIPT.md` | Follow it after `pnpm db:reset` |

## Core requirements

| Requirement | Implementation | How to verify |
|---|---|---|
| Button `🚀 Run AI-RPA Audit` | `src/components/claims/audit-button.tsx:68` | `/claims/CLM-2026-0142` → button under the invoice |
| H1 `AI-RPA Automotive Expense Inspection` | `src/app/(app)/claims/[claimId]/page.tsx:66` | Any claim page |
| Label `Original OEM/Supplier Invoice` | `src/app/(app)/claims/[claimId]/page.tsx:112` | Any claim page, left column |
| Clean-path audit entry `AI-RPA Agent` / `Automotive Expense Validated` / `Invoice matched with SAP project code successfully.` | `src/lib/domain/constants.ts:131-133`, `src/lib/audit/wording.ts:12` | Audit CLM-2026-0142 → Audit Trail |
| AI Structured Data + annotated invoice only when not Pending | `src/app/(app)/claims/[claimId]/page.tsx:49` | Before the audit the panels are absent from the DOM; after, present |
| Risk score is pure; the model never sets it | `src/lib/risk/score.ts:28`, `src/lib/risk/rules.ts` | `src/tests/risk.test.ts`; `docs/RISK_RULES.md` |
| Audit log is append-only | `prisma/schema.prisma:92`; no update/delete route under `src/app/api` | `/audit` has no edit control; `grep -rn "auditLog.update\|auditLog.delete" src` finds only the seed's wipe |
| Money: Prisma Decimal in DB, integer cents in code | `src/lib/domain/money.ts:5` | `src/tests/schema-money.test.ts` |
| Time: UTC stored, Eastern Time displayed | `src/lib/domain/dates.ts:5` | Timestamps on `/audit` end in "ET" |
| DeepSeek only from server modules, text only (OCR first) | `src/lib/ai/deepseek.ts:91`, `src/lib/ai/provider.ts:16` | `import "server-only"` at the top of both |
| CSV export of claims and the audit log, filter-aware, capped at 10 000 rows, injection-safe, bare-decimal money and UTC dates | `src/lib/export/csv.ts`, `src/lib/export/exports.ts`, `src/app/api/claims/export/route.ts`, `src/app/api/audit/export/route.ts` | `/claims` or `/audit` → **Export CSV** (carries the current filters); `pnpm test src/tests/csv.test.ts` |
| Every API route requires a session | `src/lib/auth/session.ts:54`, `src/tests/api-auth.test.ts:17` | `pnpm test src/tests/api-auth.test.ts` |

## Decisions (DECISIONS.md D-01 … D-52)

| ID | Decision | Implementation | How to verify |
|---|---|---|---|
| D-01 | R-04 near-limit advisory only when no PO covers the claim | `src/lib/risk/rules.ts:134` | CLM-2026-0148 scores 65 (R-06 + R-07), not R-04: `src/tests/risk.test.ts` |
| D-02 | Exception rate counts claims with any exception | `src/lib/kpi/formulas.ts:29` | `/dashboard` → Exception Rate card formula tooltip |
| D-03 | Extraction schema adds `projectCode`, `remitTo`, `attendees` | `src/lib/domain/schemas.ts:50` | Raw JSON on any analyzed claim |
| D-04 | Named SAP POs seeded as open; historical claims get their own POs | `src/lib/seed/historical.ts:498` | `/policies` → Open POs |
| D-05 | Periods anchored to the latest claim, not the wall clock | `src/lib/kpi/queries.ts:26` | `/dashboard` subtitle "data as of Oct 29, 2026" |
| D-06 | Vendor and date rules judged as of submission | `src/lib/risk/rules.ts:164` | `src/tests/risk.test.ts` (results do not change with the date) |
| D-07 | Decimal in DB, cents in code, sums in JS | `src/lib/domain/money.ts:5` | `src/tests/schema-money.test.ts` |
| D-08 | `db:reset` runs the seed once | `package.json:18` | `pnpm db:reset` |
| D-09 | Fonts self-hosted, offline | `src/app/layout.tsx:2` | Works with the network off |
| D-10 | Hand-written shadcn-style primitives | `src/components/ui/button.tsx:5` | `src/components/ui/` |
| D-11 | ESLint flat config (Next core web vitals + TypeScript) | `eslint.config.mjs:9` | `pnpm lint` |
| D-12 | No end-to-end browser suite; Playwright only drives screenshots and the benchmark | `scripts/screenshots.ts`, `scripts/degrade.ts` | `pnpm shots` |
| D-13 | Uploads cannot be audited in mock mode (422) | `src/lib/audit/run-audit.ts:108` | As Marcus, upload a PNG at `/claims/new` → the claim page says it "cannot be audited in Demo AI mode" |
| D-14 | Vendor-concentration watchlist only with ≥ 2 vendors | `src/lib/kpi/watchlist.ts:100` | Read the guard at `watchlist.ts:100-116`; no automated test covers it |
| D-15 | Routing by department | `src/lib/domain/constants.ts:98` | Flagged audit details end "Routed to …" |
| D-16 | AI blocks only for Analyzed (superseded by D-19) | — | See D-19 |
| D-17 | pnpm `allowBuilds` for Prisma, esbuild, unrs-resolver | `pnpm-workspace.yaml:1` | `pnpm install` without build prompts |
| D-18 | `.env` created from `.env.example` on install | `scripts/ensure-env.mjs:1` | Fresh clone → `pnpm install` creates `.env` |
| D-19 | AI panels render for Analyzed and Posted | `src/app/(app)/claims/[claimId]/page.tsx:49` | Open a Posted claim → panels visible |
| D-20 | `postedAt` / `miroDocNo` columns | `prisma/schema.prisma:44`, `src/lib/audit/miro.ts:5` | Post a claim → MIRO number on the claim page |
| D-21 | `instrumentation.ts` lives in `src/` | `src/instrumentation.ts:2` | Bad `.env` → server stops with `[env] Invalid configuration` |
| D-22 | Two-layer env validation | `src/lib/env.ts:20` | `src/tests/env.test.ts` |
| D-23 | Tailwind ignores runtime folders (no rebuild after audit) | `src/app/globals.css:5` | Run an audit in `pnpm dev` → no full reload |
| D-24 | CI badge URL | `README.md:3` | Badge links to the workflow |
| D-25 | Seeded confidence is simulated and labelled as such | `src/lib/receipts/invoice.ts:71`, `src/lib/domain/ocr-source.ts:12` | Claim page subtitle "OCR: fixture (simulated)" |
| D-26 | Email/password with revocable DB sessions | `src/middleware.ts:16`, `src/lib/auth/session.ts:54` | `src/tests/auth.test.ts`; sign out → session row deleted |
| D-27 | Three role checks, no self-approval | `src/lib/auth/session.ts:64`, `src/app/api/claims/[claimId]/post/route.ts:7` | `src/tests/roles.test.ts`; as Priya, CLM-2026-0144 shows no Resolve/Post |
| D-28 | Reviewer recorded on the exception (`resolvedBy`) | `prisma/schema.prisma:80` | Handled exception shows "by Priya Natarajan" |
| D-29 | No public registration | `src/lib/auth/demo-accounts.ts:7` | No sign-up link or route |
| D-30 | Cookie `Secure` follows the protocol | `src/lib/api.ts:29` | `pnpm build && pnpm start` → sign-in works on plain http |
| D-31 | `initiatedBy` separate from `actor` | `src/lib/audit/run-audit.ts:243`, `src/lib/audit/tone.ts:17` | `/audit` → "initiated by …" under system rows |
| D-32 | Login throttled per IP, per account and globally | `src/app/api/auth/login/route.ts:46` | `src/tests/rate-limit.test.ts` |
| D-33 | LRU-bounded limiter; residual DoS documented | `src/lib/api.ts:59` | `src/tests/rate-limit.test.ts` (LRU and hot-bucket tests) |
| D-34 | Assignment never targets the submitter | `src/lib/domain/routing.ts:8`, `src/lib/queue.ts:78` | CLM-2026-0144 header "Assigned · Plant Controller"; `/queue` |
| D-35 | Expected-loss layer beside the risk engine | `src/lib/risk/exposure.ts:24`, `src/lib/risk/economics.ts:19` | `/economics`; `src/tests/economics.test.ts` |
| D-36 | Grounded Q&A: retrieval first, template fallback, citation check | `src/lib/ask/retrieve.ts:213`, `src/lib/ask/answer.ts:79` | `/ask`; `src/tests/ask.test.ts` |
| D-37 | Seeded claims score on the fixture; R-14 uses OCR-layer signals only | `src/lib/audit/run-audit.ts:123`, `src/lib/ai/grounding.ts:75`, `src/lib/risk/rules.ts:382` | `src/tests/live-run.test.ts`, `src/tests/r14.test.ts` |
| D-38 | Offline, deterministic grounding benchmark | `scripts/grounding-bench.ts:111` | `docs/GROUNDING_BENCH.md` |
| D-39 | Reviewer dispositions as one enum; alert precision by rule | `src/lib/domain/constants.ts:61`, `src/lib/economics/precision.ts:21` | Claim → "Not an exception"; `/economics` → Alert precision by rule |
| D-40 | Realistic scan profile; OCR clean-up chosen by measurement | `src/lib/ai/preprocess.ts:245`, `src/lib/ai/ocr-prep.ts:19` | `docs/GROUNDING_BENCH.md` → Part B table; `src/tests/preprocess.test.ts` |
| D-41 | Filter-aware CSV export; no BOM; formula-injection guard | `src/lib/export/csv.ts:18`, `src/lib/export/exports.ts`, `src/lib/audit/filters.ts` | `/claims` → Export CSV; `src/tests/csv.test.ts` |
| D-42 | Accessibility fixes: contrast, dialog focus return, reflow, text alternatives | `src/components/ui/button.tsx:10`, `src/components/claims/exception-actions.tsx`, `src/components/ui/table.tsx:5`, `src/components/dashboard/charts.tsx` | `docs/ACCESSIBILITY.md` (before → after); `pnpm a11y:audit` → 0 violations |
| D-43 | Spend by site: ship-to plant, else the submitter's home site; split disclosed per row | `src/lib/locations.ts:70`, `src/lib/kpi/locations.ts:28`, `src/lib/kpi/queries.ts:154` | `/dashboard` → Spend by site; `src/tests/locations.test.ts` |
| D-44 | Field presence (4 states), PO required only on procurement ≥ $1,000, R-19 (20, High), R-14 rescan message; `PO Number: —` is absent, a blank after a label is unreadable | `src/lib/ai/labels.ts:48`, `src/lib/ai/presence.ts:25`, `src/lib/domain/field-policy.ts`, `src/lib/risk/rules.ts:383`, `src/lib/risk/rules.ts:480` | `src/tests/presence.test.ts`; `docs/RISK_RULES.md` → Field presence |
| D-45 | Variant benchmark: three columns, never one; R-14 label-without-value tightened to required fields | `src/lib/bench/variants.ts`, `scripts/extraction-variants.ts`, `src/lib/risk/rules.ts:384` | `docs/EXTRACTION_VARIANTS.md`; `src/tests/variants.test.ts`, `src/tests/presence.test.ts` |
| D-46 | R-20 Invoice Does Not Match Claim: vendor / invoice # / PO (Medium 25), total (High 40) vs the claim record | `src/lib/risk/rules.ts:511`, `src/lib/risk/exposure.ts` | `src/tests/r20.test.ts`; `docs/EXTRACTION_VARIANTS.md` → What closed column 3 |
| D-47 | Perspective: synthetic phone photos, oracle rectification, decision rule written before the run | `src/lib/bench/perspective.ts`, `src/lib/bench/photo.ts`, `src/lib/bench/capture.ts`, `src/lib/bench/variants.ts` (`recoveryDecision`) | `docs/PERSPECTIVE.md`; `src/tests/perspective.test.ts`, `src/tests/variants.test.ts` |
| D-48 | Font and capture-quality axes; shadow traced to global thresholding | `src/lib/bench/variants.ts` (`FONT_CSS`), `src/lib/bench/capture.ts` (`shadow`, `clutter`, `lowContrast`) | `docs/PERSPECTIVE.md` → Part B; `src/tests/perspective.test.ts` |
| D-49 | Page-corner detection and rectification, measured against the D-47 oracle | `src/lib/ai/corners.ts`, `src/lib/ai/perspective.ts` | `docs/PERSPECTIVE.md` (A3 rows); `src/tests/corners.test.ts` |
| D-50 | Page rectification on the upload path, with flat-scan and word-box safeguards | `src/lib/ai/ocr-prep.ts` (`rectifyForOcr`), `src/lib/ai/ocr.ts` | `src/tests/rectify-upload.test.ts` |
| D-51 | Edge candidate stage for photos on lit desks | `src/lib/ai/corners.ts` | `src/tests/corners.test.ts`, `src/tests/fixtures/photos/` |
| D-52 | Illumination normalisation in the OCR preparation (prep-v2) | `src/lib/ai/preprocess.ts`, `src/lib/ai/ocr-prep.ts` (`OCR_PIPELINE.illumination`) | `docs/ILLUMINATION.md`; `src/tests/ocr-metrics.test.ts` |

## Known limitations (README)

| Limitation | Mitigation, or why it is out of scope |
|---|---|
| SQLite and the in-memory rate limiter assume one process | Out of scope for a single-node demo. The production roadmap names PostgreSQL and Redis; the limiter's map is bounded (D-33). |
| Local email/password only; minimal roles | Out of scope: SSO/MFA belong to the identity provider. Server-side role checks and no self-approval are enforced (D-27). |
| Uploads cannot be audited in mock mode; Tesseract boxes are not mapped to fields | Explicit 422 with an explanation (D-13). Word-level OCR is now captured for uploads (D-40), the data a field mapping would need. |
| PDF uploads need rasterising before OCR | Out of scope: no PDF rasteriser dependency. PNG/JPEG work in live OCR. |
| Posting to SAP is simulated | Out of scope without an SAP system. Posting records a MIRO number and audit rows exactly where a real integration would (`src/lib/audit/disposition.ts:14`). |
| No end-to-end browser test suite | Mitigated by integration tests against a real DB (393 tests) and recorded manual runs (`docs/images/manual/`). |
| No self-service sign-up | Deliberate (D-29): an approval system must not let users pick their own role. |
| Simulated extraction confidence | Labelled in the UI ("OCR: fixture (simulated)"), never used by the model, and grounding has been measured separately on real Tesseract output (D-25, D-37, D-40). |
