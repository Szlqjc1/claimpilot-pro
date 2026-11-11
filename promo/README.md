# Promo materials

Everything Week 8 asks for, in one folder. Status is honest: what exists, what is still missing.

| # | Item | File / link | Status |
|---|---|---|---|
| 1 | Landing page | https://szlqjc1.github.io/claimpilot-pro/ | ✅ live |
| 2a | Logo (shield, invoice, arrow; navy page border) | Lockup with the wordmark: [`logo.png`](logo.png) (transparent), [`logo-on-white.png`](logo-on-white.png), [`logo-dark.png`](logo-dark.png) (for dark backgrounds), [`logo.svg`](logo.svg) (the PNG wrapped in SVG; there is no vector source). Mark only: [`logo-mark-transparent.png`](logo-mark-transparent.png), [`logo-512.png`](logo-512.png) / [`logo-128.png`](logo-128.png) / [`logo-32.png`](logo-32.png). Source: [`logo-mark-bordered.png`](logo-mark-bordered.png) | ✅ |
| 2b | Poster 1080×1080 with QR | [`poster-1080x1080.png`](poster-1080x1080.png) | ✅ |
| 2c | QR code (standalone, for reuse in Canva or print) | [`qr-code.png`](qr-code.png) — points at the landing page | ✅ |
| 2d | Survey QR (fallback door for blocked networks) | [`qr-survey.png`](qr-survey.png) — points straight at the wenjuanxing form | ✅ |
| 3 | 1-minute video (phone, real people) | — | ⬜ to shoot |
| 4 | Social post, ≤ 280 characters | [`social.md`](social.md) — both languages, with the posting checklist | ✅ written |
| 5 | Promotion started (one live post + dated screenshot) | — | ⬜ to post |

## Checks before posting

- [ ] QR scans from a second phone and opens the landing page
- [ ] Poster still legible when shrunk to a thumbnail
- [ ] Landing page opens from a phone, inside WeChat, logged out
- [ ] Video is under 60 seconds, a team member on camera, no AI faces or voices
- [ ] Post text contains: the problem, the app, the one action, the link or QR
- [ ] Post link + a screenshot **showing the date** are saved the day it goes out

## The one action

Every piece points at the same thing: **open the landing page and leave feedback.**

The feedback button currently opens a GitHub issue (`[FEEDBACK] ClaimPilot PRO beta feedback`). When the
Wenjuanxing / Tencent Questionnaire link exists, replace `SURVEY_URL` in `docs/index.html` and every button
follows.

## Where the numbers come from

None of the poster or page figures are invented. Each is produced by the repo:

- landing page, poster: `pnpm kpi:report` (130 claims, `$3,815,541.16`, auto-clear 65.8 %, cycle 9.6 h)
- expected-loss and cost curve: `pnpm cost:curve`, written up in `docs/ECONOMICS.md`
- grounding and false-alarm rates: `pnpm bench:grounding`, written up in `docs/GROUNDING_BENCH.md`
- label/layout robustness: `pnpm bench:variants`, written up in `docs/EXTRACTION_VARIANTS.md`

## Fictional data

Every company, supplier, tax ID, person and invoice is fictional. Each generated receipt carries a
`SAMPLE — NOT A REAL INVOICE` watermark. No SAP connection, no ISO 27001 / SOC 2 claim.
