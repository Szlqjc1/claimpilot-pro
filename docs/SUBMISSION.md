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
| 232+ automated tests (unit + integration against a real SQLite DB) | `src/tests/` (24 files) | `pnpm test` → "Tests 232 passed" or more |
| CI runs install, migrate, lint, typecheck, test, build | `.github/workflows/ci.yml:27-35` | GitHub Actions badge at the top of `README.md` |
| Deterministic risk engine; 7 hero claims with exact scores | `src/lib/risk/score.ts:28`, `src/tests/risk.test.ts:13` | `pnpm test src/tests/risk.test.ts`; `pnpm db:seed` throws if any hero score drifts (`src/lib/seed/run.ts:130`) |
| KPI targets | `src/lib/kpi/formulas.ts:44`, `scripts/kpi-report.ts` | `pnpm kpi:report` → every row `OK` |
| Grounding benchmark: false alarms **harsh 55.8 %**, **realistic 15.2 % → 12.2 %** after OCR clean-up; 852 injected errors, 69.7 % caught end-to-end | `docs/GROUNDING_BENCH.md`, `scripts/grounding-bench.ts:111` | Read the report; `pnpm bench:grounding` (needs `./eng.traineddata`, ~31 min cold, seconds cached) |
| Review economics and cost curve (`review ⇔ p·L > c`) | `docs/ECONOMICS.md`, `src/lib/risk/economics.ts:19` | `/economics`; `pnpm cost:curve` |
| Retrieval-first grounded Q&A with citation check | `docs/AI_GOVERNANCE.md`, `src/lib/ask/answer.ts:79` | `/ask` → click an example; the badge says **Template** in mock mode |
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
| Every API route requires a session | `src/lib/auth/session.ts:54`, `src/tests/api-auth.test.ts:17` | `pnpm test src/tests/api-auth.test.ts` |

## Decisions (DECISIONS.md D-01 … D-40)

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

## Known limitations (README)

| Limitation | Mitigation, or why it is out of scope |
|---|---|
| SQLite and the in-memory rate limiter assume one process | Out of scope for a single-node demo. The production roadmap names PostgreSQL and Redis; the limiter's map is bounded (D-33). |
| Local email/password only; minimal roles | Out of scope: SSO/MFA belong to the identity provider. Server-side role checks and no self-approval are enforced (D-27). |
| Uploads cannot be audited in mock mode; Tesseract boxes are not mapped to fields | Explicit 422 with an explanation (D-13). Word-level OCR is now captured for uploads (D-40), the data a field mapping would need. |
| PDF uploads need rasterising before OCR | Out of scope: no PDF rasteriser dependency. PNG/JPEG work in live OCR. |
| Posting to SAP is simulated | Out of scope without an SAP system. Posting records a MIRO number and audit rows exactly where a real integration would (`src/lib/audit/disposition.ts:14`). |
| No end-to-end browser test suite | Mitigated by integration tests against a real DB (232+ tests) and recorded manual runs (`docs/images/manual/`). |
| No self-service sign-up | Deliberate (D-29): an approval system must not let users pick their own role. |
| Simulated extraction confidence | Labelled in the UI ("OCR: fixture (simulated)"), never used by the model, and grounding has been measured separately on real Tesseract output (D-25, D-37, D-40). |
