# Accessibility

Evidence, not claims. Everything below was measured on 2026-11-06 by `pnpm a11y:audit` (`scripts/a11y-audit.ts`)
against `pnpm dev` on a freshly seeded database, signed in as the reviewer Priya Natarajan: Playwright Chromium
156, axe-core 4.14.0 (already installed with `eslint-plugin-jsx-a11y`; no new dependency), WCAG 2.2 A/AA rule tags.
Raw output: [`docs/images/manual/a11y-evidence.json`](images/manual/a11y-evidence.json). No screen reader (NVDA,
VoiceOver) was run, so screen-reader announcements below are inferred from the markup, not heard.

## axe-core results

| Page | Violations (rules / nodes) | What fails | Screenshot |
|---|---|---|---|
| `/login` | 1 / 1 | `color-contrast`: **Sign in** button, white on `#f97316` = 2.8:1 | [axe-login.png](images/manual/axe-login.png) |
| `/dashboard` | **0** (30 rules pass, 1 needs manual review) | — | [axe-dashboard.png](images/manual/axe-dashboard.png) |
| `/claims/CLM-2026-0142` | 1 / 1 | `color-contrast`: **🚀 Run AI-RPA Audit** button, white on `#f97316` = 2.8:1 | [axe-claim-0142.png](images/manual/axe-claim-0142.png) |
| `/queue` | 1 / 48 | `color-contrast`: the orange **Review / Post / Audit** buttons (2.8:1), and the risk score inside a risk badge, faded with `opacity-80` (`#c46b35` on `#fffbeb` = 3.68:1) | [axe-queue.png](images/manual/axe-queue.png) |
| `/economics` | **0** (30 rules pass) | — | [axe-economics.png](images/manual/axe-economics.png) |

Every violation comes from two styles: the orange primary button and the faded score in a risk badge. Each
screenshot carries the axe summary in its bottom-right corner.

## Contrast (measured)

WCAG 2.2 AA thresholds: **4.5:1** for body text, **3:1** for large text (≥ 24 px, or ≥ 18.66 px bold) and for
non-text UI components (1.4.11). Colours were measured by painting each computed colour onto a canvas, because the
Tailwind 4 palette is `oklch`.

| Pair | Foreground | Background | Ratio | AA body text |
|---|---|---|---:|---|
| `--color-muted` on white | `#667085` | `#ffffff` | 4.97 | pass |
| `--color-muted` on the page background `--color-canvas` | `#667085` | `#f3f5f7` | 4.55 | pass (barely) |
| `--color-success` on white | `#067647` | `#ffffff` | 5.69 | pass |
| `--color-warning` on white | `#b54708` | `#ffffff` | 5.43 | pass |
| `--color-danger` on white | `#b42318` | `#ffffff` | 6.57 | pass |
| `--color-info` (links) on white | `#175cd3` | `#ffffff` | 5.99 | pass |
| `--color-ink` on white | `#101828` | `#ffffff` | 17.75 | pass |
| Badge neutral | `#314158` | `#f8fafc` | 9.90 | pass |
| Badge amber | `#b54708` | `#fffbeb` | 5.23 | pass |
| Badge blue | `#175cd3` | `#eff6ff` | 5.50 | pass |
| Badge green | `#067647` | `#ecfdf5` | 5.40 | pass |
| Badge red | `#b42318` | `#fef2f2` | 6.01 | pass |
| Badge orange | `#c2410c` | `#fff7ed` | 4.88 | pass |
| Badge navy | `#ffffff` | `#122c47` | 14.22 | pass |
| **Primary button** (white on `--color-accent`) | `#ffffff` | `#f97316` | **2.80** | **fail** (also fails 3:1) |
| **Risk-badge score at `opacity-80`** (amber badge) | `#c46b35` | `#fffbeb` | **3.68** | **fail** |

## Keyboard walkthrough (observed)

Recorded by pressing Tab from page load and reading `document.activeElement`.

1. **Sign-in (`/login`).** Focus starts in **Email** (`autoFocus`). Tab: Password → **Sign in** → leaves the page →
   Email. No skip link is needed: the page is a single form. The demo-account cards are text, not focus stops.
2. **Dashboard (`/dashboard`).** Tab 1 is **Skip to content** (visible on focus). Then: brand link, the seven nav
   links (the active one has `aria-current="page"`), Search claims, **Sign out**, **New Claim**, then the filters.
   Activating the skip link moves the sequential-focus point into `<main>`: the next Tab lands on **New Claim**, the
   first control in the content. `document.activeElement` reports `<body>`, because `#main` has no `tabindex="-1"`.
3. **Claim review (`/claims/CLM-2026-0142`).** The same 12 shell stops plus the breadcrumb "Claims" link, then the
   invoice viewer: Zoom out, Zoom in, Fit to width, Open, Download, then **🚀 Run AI-RPA Audit** (stop 18).
4. **Exception dialog** (`/claims/CLM-2026-0075`, "Not an exception", opened with Enter). Focus lands in the
   required note field ("Why is this not an exception?"). Tab cycles note → Cancel → note: focus is **trapped**. The
   submit button is skipped while it is disabled (note shorter than 10 characters). **Escape closes the dialog, but
   focus goes to `<body>`, not back to the trigger button** (see gaps).
5. **Post dialog** (`/claims/CLM-2026-0065`, "Post to SAP", opened with Enter). Focus lands on **Cancel** (the safe
   default for an irreversible action). Tab cycles Confirm posting ↔ Cancel: **trapped**. Escape closes and **focus
   returns to "Post to SAP"**.

## Known gaps

| Gap | Impact | Fix (not done here) |
|---|---|---|
| Orange primary buttons are 2.8:1 (Sign in, 🚀 Run AI-RPA Audit, queue actions) | WCAG 1.4.3 fail on the most important controls | Use `--color-accent-strong` (`#c2410c`, 5.18:1 with white) for the button background, keeping the orange for accents |
| Risk score inside a badge uses `opacity-80` (3.68:1) | 1.4.3 fail on every risk badge with a score | Drop the opacity; use font weight to de-emphasise |
| Exception dialog does not return focus to its trigger | Keyboard users lose their place after Escape or after submitting | Use `Dialog.Trigger` as the post dialog does, or restore focus in `onCloseAutoFocus` |
| Narrow screens: at 390 px **the whole page** scrolls horizontally, not just the exceptions table | 1.4.10 Reflow fail on the claim page | Let the claim header and badge row wrap; keep only the exceptions table in its own horizontal scroller |
| The risk meter is `role="meter"` with `aria-valuenow` but no `aria-valuetext` | A screen reader hears "Risk score 100", not "High". The level is shown next to it as a text badge, so colour is not the only signal, but the meter alone does not say it | Add `aria-valuetext="100 of 100, High"` |
| Charts are `role="img"` with an `aria-label` summary and no data table | Values in the charts are not available to screen-reader users except as a one-line summary | Add a visually hidden table per chart, or link to the filtered claims list / CSV export |
| The skip link's target `#main` is not focusable | Works for sequential navigation in Chromium; some assistive technologies may not move their reading position | Add `tabIndex={-1}` to `<main>` |
| No screen-reader run; axe "needs review" items (1 on `/dashboard`, 1 on the claim page) were not resolved by hand | Unknown | Run NVDA + Chrome and VoiceOver + Safari through the demo script |

## What was done deliberately

- **Skip link** to `#main` on every signed-in page (`src/app/(app)/layout.tsx:13`), visible on focus.
- **`aria-current="page"`** on the active nav link, the claims status tabs and the topbar breadcrumb.
- **Live regions**: 8 `role="alert"` (errors, warnings, the extraction-diff banner), 3 `role="status"` and 7
  `aria-live` regions (for example the note character count and the Q&A answer).
- **Colour is never the only signal**: every badge carries text ("High", "Dismissed · not an exception"), grounding
  chips say "✓ found" / "✗ not found", and the invoice legend is labelled.
- **`prefers-reduced-motion`** disables animations and transitions (`src/app/globals.css:52`).
- **Radix dialogs** trap focus (verified above for both dialogs); the post dialog opens on Cancel and returns focus
  to its trigger.
- **Icon-only buttons have names** (Zoom out, Zoom in, Fit to width; Sign out has visible or `sr-only` text), forms
  have `<label>`s, and the document declares `lang="en"`.
- **No information in colour alone on charts**: each chart has an `aria-label` summary (see gaps for its limits).

Re-run the evidence with `pnpm dev` in one terminal and `pnpm a11y:audit` in another (it only opens and cancels
dialogs; nothing is written).
