# Accessibility

Evidence, not claims. Everything below was measured on 2026-11-06 by `pnpm a11y:audit` (`scripts/a11y-audit.ts`)
against `pnpm dev` on a freshly seeded database, signed in as the reviewer Priya Natarajan: Playwright Chromium
156, axe-core 4.14.0 (already installed with `eslint-plugin-jsx-a11y`; no new dependency), WCAG 2.2 A/AA rule tags.
Raw output: [`docs/images/manual/a11y-evidence.json`](images/manual/a11y-evidence.json). No screen reader (NVDA,
VoiceOver) was run, so screen-reader announcements below are inferred from the markup, not heard.

## axe-core results

Before = the first audit (commit `8e847f8`); after = this version.

| Page | Before (rules / nodes) | After | Screenshot before | Screenshot after |
|---|---|---|---|---|
| `/login` | 1 / 1: `color-contrast` on **Sign in** (white on `#f97316` = 2.8:1) | **0** | [axe-before-login.png](images/manual/axe-before-login.png) | [axe-login.png](images/manual/axe-login.png) |
| `/dashboard` | 0 | **0** (1 item needs manual review, see gaps) | — | [axe-dashboard.png](images/manual/axe-dashboard.png) |
| `/claims/CLM-2026-0142` | 1 / 1: `color-contrast` on **🚀 Run AI-RPA Audit** (2.8:1); 1 needs review: `aria-label` on the amount `<p>` | **0**, nothing to review | [axe-before-claim-0142.png](images/manual/axe-before-claim-0142.png) | [axe-claim-0142.png](images/manual/axe-claim-0142.png) |
| `/queue` | 1 / 48: `color-contrast` on the orange **Review / Post / Audit** buttons (2.8:1) and the faded risk score in badges (3.68:1) | **0** | [axe-before-queue.png](images/manual/axe-before-queue.png) | [axe-queue.png](images/manual/axe-queue.png) |
| `/economics` | 0 | **0** | — | [axe-economics.png](images/manual/axe-economics.png) |

Each screenshot carries the axe summary in its bottom-right corner.

**Which screenshots show the old orange on purpose.** The three `axe-before-*.png` files are the intentional *before*
state: they were extracted unchanged from commit `8e847f8` and show the 2.8:1 orange buttons that failed
`color-contrast`. They were captured while the dev server ran with `AI_MODE=live`; the axe audit runs no AI audit, so
no model call was involved, but the topbar badge in them reads "DeepSeek live". Every other image under
`docs/images/manual/` (`axe-*.png` without `before`, `auth-*.png`, `roles-*.png`) is current: it was captured after the
D-42 colour change, in mock mode (`pnpm a11y:audit`, `pnpm evidence:shots`).

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
| Badge neutral / amber / blue / green / red / orange / navy | — | — | 9.90 / 5.23 / 5.50 / 5.40 / 6.01 / 4.88 / 14.22 | pass |
| **Primary button**, now white on `--color-accent-strong` | `#ffffff` | `#c2410c` | **5.18** (was 2.80 on `#f97316`) | pass |
| **Risk-badge score**, now at full strength (amber badge) | `#b54708` | `#fffbeb` | **5.23** (was 3.68 at `opacity-80`) | pass |

## Keyboard walkthrough (observed)

Recorded by pressing Tab from page load and reading `document.activeElement`.

1. **Sign-in (`/login`).** Focus starts in **Email** (`autoFocus`). Tab: Password → **Sign in** → leaves the page →
   Email. No skip link is needed: the page is a single form. The demo-account cards are text, not focus stops.
2. **Dashboard (`/dashboard`).** Tab 1 is **Skip to content** (visible on focus). Then: brand link, the seven nav
   links (the active one has `aria-current="page"`), Search claims, **Sign out**, **New Claim**, then the filters.
   Activating the skip link now moves focus to `<main>` (`tabIndex={-1}`); the next Tab lands on **New Claim**.
3. **Claim review (`/claims/CLM-2026-0142`).** The same 12 shell stops plus the breadcrumb "Claims" link, then the
   invoice viewer: Zoom out, Zoom in, Fit to width, Open, Download, then **🚀 Run AI-RPA Audit** (stop 18).
4. **Exception dialog** (`/claims/CLM-2026-0075`, "Not an exception", opened with Enter). Focus lands in the
   required note field. Tab cycles note → Cancel → note: **trapped**; the submit button is skipped while disabled.
   **Escape now returns focus to the "Not an exception" button.** After a successful disposition that button no
   longer exists, so focus moves to the **Exceptions** heading (checked by submitting a dismissal on a scratch
   database, then reseeding).
5. **Post dialog** (`/claims/CLM-2026-0065`, "Post to SAP", opened with Enter). Focus lands on **Cancel** (the safe
   default for an irreversible action). Tab cycles Confirm posting ↔ Cancel: **trapped**. Escape returns focus to
   **Post to SAP**.

**Reflow at 390 px:** every page fits the viewport (`/dashboard`, `/claims`, a claim, `/queue`, `/economics`,
`/audit`, `/ask`); only wide data tables scroll horizontally inside their own card, which WCAG 1.4.10 allows for
data tables. The cause of the earlier page-wide scrolling was visually hidden (`sr-only`) labels inside table cells:
they are absolutely positioned, escaped the table's scroll container and stretched the page. The scroll container is
now `position: relative`.

## Gaps fixed in this version

| Gap (first audit) | Fix |
|---|---|
| Orange primary buttons at 2.8:1 | Background is `--color-accent-strong` (5.18:1), hover `orange-800`; the brand orange stays for decorative marks |
| Risk score in badges at 3.68:1 (`opacity-80`) | Full-strength text (5.23:1) |
| Exception dialog lost focus on close | `onCloseAutoFocus` returns focus to the trigger, or to the Exceptions heading after a successful disposition |
| Page scrolled sideways at 390 px | Table scroll container is `position: relative`, so `sr-only` labels stay inside it |
| Risk meter announced only the number | `aria-valuetext="100 of 100, High"` |
| Charts had only a one-line summary | Each chart renders its values as a visually hidden table (caption, column and row headers) |
| Skip-link target not focusable | `<main tabIndex={-1}>` |
| `aria-label` on a plain `<p>` (the claim amount) | Removed; the visible text already says the amount |

## Known gaps (remaining)

| Gap | Impact | Next step |
|---|---|---|
| No screen-reader run | Announcements are inferred from markup, not heard | Run NVDA + Chrome and VoiceOver + Safari through `docs/DEMO_SCRIPT.md` |
| axe "needs review" on `/dashboard`: `color-contrast` on very short text such as "·" and "—" (axe cannot judge one-glyph text) | Probably none; the glyphs are `text-slate-400` placeholders | Check by eye; mark decorative separators `aria-hidden` (done for the header separator) |
| `--color-muted` on the page background is 4.55:1 | Passes, with almost no margin | Darken `--color-muted` slightly if the palette is revisited |
| Charts are still visual-first | The hidden tables give the values, but there is no visible table toggle for sighted keyboard users | Optional "Show data" toggle per chart |

## What was done deliberately

- **Skip link** to `#main` on every signed-in page (`src/app/(app)/layout.tsx:13`), visible on focus.
- **`aria-current="page"`** on the active nav link, the claims status tabs and the topbar breadcrumb.
- **Live regions**: 8 `role="alert"` (errors, warnings, the extraction-diff banner), 3 `role="status"` and 7
  `aria-live` regions (for example the note character count and the Q&A answer).
- **Colour is never the only signal**: every badge carries text ("High", "Dismissed · not an exception"), grounding
  chips say "✓ found" / "✗ not found", and the invoice legend is labelled.
- **`prefers-reduced-motion`** disables animations and transitions (`src/app/globals.css:52`).
- **Radix dialogs** trap focus and return it to the trigger (verified above for both dialogs); the post dialog opens
  on Cancel.
- **Icon-only buttons have names** (Zoom out, Zoom in, Fit to width; Sign out has visible or `sr-only` text), forms
  have `<label>`s, and the document declares `lang="en"`.
- **Charts are not colour-only**: each has an `aria-label` summary and a visually hidden data table.

Re-run the evidence with `pnpm dev` in one terminal and `pnpm a11y:audit` in another (it only opens and cancels
dialogs; nothing is written).
