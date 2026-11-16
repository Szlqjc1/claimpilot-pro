# ClaimPilot PRO — Demo Day script (English only)

No promotion section in this version. Speech is about 5:15; the remaining 45 seconds are for the demo's waits and
transitions, which always take longer than the script does.

Numbers are read as written: `65.8 %` → "sixty-five point eight per cent", `9.6 h` → "nine point six hours".

## Before your slot

- `pnpm db:seed` — resets the demo book; CLM-2026-0147 goes back to Pending with its fixture
- Run the audit once on CLM-2026-0147 on this laptop, so you know how long it actually takes
- Log in before you are called; leave the claim page open
- Keep the 60-second video on the desktop. If the network dies, present from that file
- In the default demo mode an **uploaded** invoice returns `422 OCR_DISABLED` when the audit runs. Demo the audit on
  the seeded claim; show the upload screen as a still, or switch to live mode and test it beforehand

---

## 0:00–0:45 — Problem and user

`[PPT 1]` The poster, or a photo of a paper invoice on a desk.

> ClaimPilot PRO is an audit tool for accounts payable. Two people use it.
> The first files invoices. An employee buys parts for a test, or visits a supplier. They pay, keep the receipt,
> submit it — and then wait. Sometimes it comes back for a missing document. Sometimes nothing happens at all.
> The second is the reviewer in finance. Most of her queue needs no decision, and she reads it anyway.
> Four screens, three questions: how are we doing, is this invoice right, and what should we do about it.

## 0:45–3:15 — Live demo

`[Browser]` Signed in, CLM-2026-0147 open.

**The cockpit**

> I'll sign in as the reviewer. This is the cockpit, and it answers the first question: where is it stuck.
> Total spend, auto-clear rate, exception rate, high-risk exposure, cycle time — all computed live over a demo book
> of 130 claims worth 3.8 million dollars. 65.8 % clear the rules with no exception; a person still posts to SAP.
> 9.6 hours from submission to analysed. The manual end-to-end baseline is 4.2 days.

**The audit**

> Now one invoice. I upload it, then fill in the claim: category, project code, vendor, amount. The audit compares
> what I typed with what the scan reads — and a mismatch between the invoice and the claim is a finding in its own
> right.
> Submit. Run the audit. `[wait]`
> What comes back is not a paragraph. Vendor, invoice number, date, PO, total — each field carries a chip: found in
> the scanned text, or not. Beside it, the scan's confidence: one number for the whole page, because that is what OCR
> actually returns.
> The annotated invoice draws the same fields onto the page, so I can follow any number back to where it came from.
> And when a field cannot be read, it says so. It does not guess.

**The score**

> Here is the score. Twenty rules check the claim; the ones that fire add up to the number. The model reads the text
> and writes the explanation. It never sets the score.
> Open "How this was calculated" and you get the rules that fired, the points each one added, and the reason.

**The trail**

> Every step is written down: who submitted, what the system found, who cleared it, when it was posted. The app has
> no way to edit or delete an entry. Posting stays locked until every exception is cleared — here there is one open,
> so the button is disabled.

## 3:15–4:15 — Users and changes

`[PPT 2]` Four before/after pairs, one screenshot each.

> We put this in front of ten testers. Four things came back, and all four are fixed in the build you are looking at.
> The primary button failed contrast on a bright projector: 2.8 to one. We measured it, and changed the colour.
> Two entries in the audit log differed by one letter. In a long list nobody could tell them apart. One is renamed.
> A successful posting came out in red, because the colour was hard-coded. People assumed it had failed.
> And a confidence number sat on the screen without saying where it came from. It now reads "OCR: fixture
> (simulated)" — a demonstration fixture, not a measurement.

## 4:15–5:15 — What was hard, what we learned

`[PPT 3]` Two numbers, one above the other: 20 / 98 and 98 / 98.

> The hardest thing was not the code. It was the photographs.
> The first version only worked on flat scans. We put a shadow across a third of one invoice: it recovered 20 of 98
> critical values, and every one of twenty otherwise-clean invoices was escalated to a human.
> So we normalise the lighting before OCR. The same page now gives 98 of 98, and all twenty clear.
> On ordinary phone photos our false-alarm rate is still 12.2 %. That is above the line we set ourselves, and it is
> in the report.
> That is what I am taking away. Not a design problem, not a model problem — a problem with the conditions our users
> actually work in. We found it because we degraded our own documents instead of trusting a clean scan.
> And building with AI: it writes fast, and it sounds just as confident when it is wrong. Most of the work was not
> writing. It was checking — and turning "I am not sure" into a rule.

## 5:15–6:00 — Slack, then close

The 45 seconds here are for the audit wait, a page change, and one breath.

> ClaimPilot PRO. The link is on the QR code. Thank you.

---

## Facts this script asserts, and where each comes from

| Claim in the script | Source |
|---|---|
| 130 claims, $3,815,541.16 | `pnpm kpi:report`; seed run |
| 65.8 % auto-clear | same |
| 9.6 h cycle, 4.2-day manual baseline | same |
| 20 rules, R-01…R-20; only firing rules add points | `src/lib/risk/rules.ts`; `RISK_RULES.md` |
| "How this was calculated" | risk panel label |
| Page-level OCR confidence for uploads | `src/lib/domain/ocr-source.ts` |
| "OCR: fixture (simulated)" | same |
| No edit/delete route for the audit log | `src/app/(app)/audit` route list |
| Posting locked while an exception is open | claim page, `Post to SAP` disabled |
| Button contrast was 2.8:1 | D-42, `docs/ACCESSIBILITY.md` |
| Two log entries one letter apart | commit `22b8b8f` |
| Success shown in red, now green | commit `36ac45c` |
| 10 testers / 10 responses | Wenjuanxing export |
| Shadow across a third of the page: 20 of 98 critical values, then 98 of 98 | `docs/ILLUMINATION.md` L34–35 |
| 12.2 % false alarms on realistic phone photos | `docs/GROUNDING_BENCH.md` L23 |
| Uploaded invoice → `422 OCR_DISABLED` in demo mode | `src/lib/audit/run-audit.ts:109` |
