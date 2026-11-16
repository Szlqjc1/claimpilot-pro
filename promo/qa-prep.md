# ClaimPilot PRO — Q&A brief (4 minutes)

Eight questions, about 30 seconds each. Every answer below is short enough to say out loud, and every one points at
something you can show. **Whoever owns a question answers it; the others stay quiet.**

Rule for the round: **answer, evidence, stop.** The panel interrupts when they want more. A 60-second answer to a
20-second question is how teams lose their own Q&A time.

---

## Q1 · Who exactly is the user, and how do you know the pain is real?

**Answers: Bowen Zhang**

> Two roles, not one persona. The person who files the invoice — buys parts, pays, submits, waits. And the reviewer in
> finance, whose queue is mostly invoices that need no decision.
> We started from the process rather than a persona. In our demo data the manual baseline is 4.2 days end to end, and
> of the ten people we surveyed, seven work in finance or audit and five still handle paper.

**Show:** the dashboard, the `Avg Cycle Time` card with its 4.2-day baseline — then the survey table for Q1/Q2.

**Do not say:** "anyone who pays bills" or "every company". Both invite the follow-up you cannot answer.

---

## Q2 · Who did you test with, what did they say, what did you change?

**Answers: Wu Yiming**

> Ten testers: four in audit, three in finance, two developers, one student. Four findings came back, and all four are
> fixed in the build you are looking at.
> The primary button failed contrast on a bright projector — 2.8 to 1, now 5.18. Two audit-log entries differed by one
> letter; one is renamed. A successful posting was shown in red, because the colour was hard-coded. And a confidence
> number sat on screen with no source — it now reads "OCR: fixture (simulated)".

**Show:** slide 4, then the audit log itself if they want the before/after.

**If pushed on "only ten":** "Ten, and mostly students — it is in the report. That means the answers tell us about
comprehension, not about procurement authority. We say so rather than dress it up."

---

## Q3 · Which channel worked best, and how many testers did it bring?

**Answers: Yuzhuo He**

> The video is on Bilibili; the form is on Wenjuanxing. The form did the work — a form gets finished where a video gets
> watched. Ten responses came back through it, every question answered.
> The lowest-friction entry is the QR on the poster: no account, no link to paste.

**If they ask for reach:** give the number only if you have a dated screenshot of it. Otherwise: "I have responses, not
views — the view count is on the Bilibili dashboard and I did not capture it." That sentence is survivable; an invented
number is not.

**Do not say:** "it went viral", or any percentage of a population you cannot name.

---

## Q4 · Why this stack, and what happens at a thousand concurrent users?

**Answers: Mingxuan Wang**

> Next.js, React, Prisma, Zod, Vitest. The reason is narrow: one team can run the whole thing, and every risk rule is a
> pure function with a test.
> At a thousand concurrent users it breaks in three known places. SQLite has a single writer. The audit runs
> synchronously inside the request. And the model calls are unbounded. The fix is PostgreSQL, a job queue, and a
> rate-limited model client. None of the twenty rules changes — that is the point of keeping them deterministic.

**Show:** `prisma/schema.prisma` (provider on line 3), then the rules file.

**Do not say:** "it scales" or "we'd just add servers". Naming the three bottlenecks is the strong answer.

---

## Q5 · What was the biggest obstacle, and who helped?

**Answers: Shuo Yuan**

> The photographs. The first version only worked on flat scans: with a shadow across a third of one invoice it
> recovered 20 of 98 critical values, and every one of twenty otherwise-clean invoices went to a human. After
> normalising the lighting before OCR, the same page gives 98 of 98.
> We found it because we degraded our own documents instead of trusting a clean scan.

**Who helped — fill this in with a real name and one real thing they said.** The honest shape is:
"__ looked at our plan and said __, which is why we changed __." If no one helped with this particular problem, say
that too: "we did not ask anyone about this; we should have, and here is who we would ask."

---

## Q6 · What do you build next, and why that?

**Answers: Sun Yuan**

> Three things, in this order. Multi-currency — the entity invoices in CNY as well as USD and we only model USD. A
> vendor-master sync, because a bank-detail check is only as good as the master it reads. And the false-alarm rate:
> 12.2 % on ordinary phone photos is above the 10 % line we set ourselves, and every false alarm costs a reviewer
> about half an hour.

**Do not say:** "more AI features". The panel is asking what the product needs, not what is fun to build.

---

## Q7 · Show us the database and explain how one part works

**Answers: Mingxuan Wang** · laptop ready, `pnpm db:studio` already running before the session

> This is the claim, this is its score, and these are the exception rows behind it. The score is not a number anyone
> typed — it is the sum of the rule rows, capped at 100. Here are the three rows: R-03 at 60 points.
> And every decision writes an audit row that carries the rule ids, the mode and the decision, so the same question can
> be answered a month later.

**Show:** `Claims` → `Exceptions` → `AuditLog`, in that order. Same claim, three tables.

**If the demo machine has no browser:** show `prisma/dev.db` in the file manager, then read one row from
`AuditLog.metadata` — the JSON carries `rules`, `mode` and `decision`.

---

## Q8 · (unlikely, but) Softr was in your plan — is this the same product?

**Answers: Jincheng Qian**

> Softr was the sample build from the first checkpoint — pages and forms to test whether the flow made sense. The
> product you are looking at is Next.js with a real database; the prototype is what told us which screens mattered.

**Do not say:** "the Softr one was the real one." It is not, and the repository settles it.

---

## When you do not know

Say this, in this order:

1. "I don't know." — no hedging, no guessing.
2. "Here is how we would find out." — name the method and the timeframe.
3. "Here is what we do know that is adjacent." — one sentence, then stop.

Example: "I don't know what our OCR does on a photocopied invoice — we never tested a third-generation copy. We would
run the same degradation benchmark with a copy arm, which is a day of work."

---

## Three traps, and the one-line answer for each

| Trap | Answer |
|---|---|
| "Ten students is not a real sample." | "Correct, and it is in the report. It tells us about comprehension, not about procurement authority." |
| "Is 65.8 % your users?" | "No — it is computed live over a fictional demo book of 130 claims, and the dashboard label says fictional." |
| "So the AI makes the decision?" | "No. Twenty rules score it; the model writes the explanation and never sets the number." |

---

## Who is on what

| Person | Owns | Backup for |
|---|---|---|
| Shuo Yuan | Q5, open and close | anything unclaimed |
| Bowen Zhang | Q1 | Q2 |
| Wu Yiming | Q2 | Q8 |
| Yuzhuo He | Q3 | Q1 |
| Mingxuan Wang | Q4, Q7 | Q6 |
| Sun Yuan | Q6 | Q4 |
| Jincheng Qian | Q8 | Q7 |

**Every person must be able to walk the product for 60 seconds.** The likely first request is "start from the top",
and it should not matter who is holding the laptop.
