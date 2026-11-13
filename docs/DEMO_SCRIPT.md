# Demo script (6–8 minutes)

**Before you start (not on the clock).** Run `pnpm db:seed && pnpm dev`. Check that `.env` has `AI_MODE="mock"` (or no
`AI_MODE` at all): the topbar badge must read **Demo AI**, not DeepSeek live. No API key is needed. Open
**http://localhost:3000** and keep using `localhost` for the whole demo. The session cookie belongs to the host you
signed in on, so a link that opens `127.0.0.1:3000` sends you back to sign-in. That is expected, not a bug.

Demo accounts, all shown on the sign-in page:

| Account | Role | Can |
|---|---|---|
| `priya.natarajan@ironwood.example` / `Toledo-Controller-26` | Reviewer (Plant Controller) | Everything in this script |
| `dana.whitfield@ironwood.example` / `Ironwood-Audit-2026` | Admin | Everything a reviewer can |
| `marcus.reed@ironwood.example` / `CrashSled-Request-26` | Requester | Submit claims and run the audit; no resolve, dismiss or post |

---

### 1. Sign in as Priya (0:00–0:30)

Open any page: you land on `/login`. Sign in as **Priya Natarajan**. The topbar shows her name, her role and
**Demo AI**. Every action from here on is recorded under her name.

### 2. `/dashboard`: ten KPIs (0:30–1:30)

- Six headline cards: Total Claim Spend, Claims in Scope, **Auto-Clear Rate 65.8 %**, Exception Rate, High-Risk
  Exposure, and **Avg Cycle Time 9.6 h** against the **4.2-day** (100.8 h) manual baseline.
- Four secondary cards: OCR Straight-Through, Duplicate Recovery, Benchmark Variance, Budget Utilization.
- Hover any card to see its formula. Every number is computed from the claims table, not typed in.
- Optional: filter Department → Plant Operations. The cards, charts and URL all update. Then **Reset filters**.
- The claims list has **Export CSV**. It exports the rows that match the current filters.

### 3. `/queue`: who works on what (1:30–2:15)

- **Assigned to you** lists claims the audit flagged and routed department → role → owner, here to Priya.
  It is grouped as Pending audit / Needs disposition / Ready to post.
- **Unassigned** lists claims nobody owns yet: not audited, clean, or submitted by the role owner.
- **Separation of duties:** nobody, reviewer or admin, may resolve, dismiss or post a claim they submitted. Priya's own
  submissions are routed past her and are not listed for her. Open one such claim, e.g. CLM-2026-0073: the Post to SAP
  bar says *You submitted this claim, so another reviewer must resolve and post it*.

### 4. CLM-2026-0147: the audit (2:15–3:30)

Open **CLM-2026-0147** (The Vantage Room Detroit, $2,451.57, submitted by Tyler Brooks). The page shows the
**Original OEM/Supplier Invoice**. AI Structured Data and the annotated invoice are not on the page yet.

Click **`🚀 Run AI-RPA Audit`**. When the button reads **✅ Audit complete**:

- **AI Structured Data** appears. Each extracted field has a **grounding chip**: whether its value was found in the
  OCR text of the scan, with the OCR confidence. The model reads text, and these chips check its answer against the scan.
- The **AI-Annotated Invoice** draws the same fields on the scan, coloured by the same legend.
- Risk Assessment: **50 · Medium · REVIEW**, one exception, Entertainment Policy Violation (R-12). Open *How this was
  calculated*: the score comes from a deterministic rule engine, and the LLM only explains it. The audit trail reads
  *Routed to …*, and the header shows **Assigned · Priya Natarajan**.

### 5. Three dispositions (3:30–4:30)

- **Resolve.** On 0147, click **Resolve** on the R-12 row. Add a note (at least 10 characters), e.g. *Attendee list for
  the LMX-7 launch dinner attached; alcohol approved by plant manager.* The row now reads *by Priya Natarajan*.
- **Dismiss.** Open **CLM-2026-0067** (Toledo Conveyor & Maintenance). Click **Dismiss** on the R-08 Price Variance row.
  The dialog asks *Why is this not an exception?* This is the third disposition, next to Resolve and Waive: Waive means
  "the finding is real but accepted", and Dismiss means "the rule was wrong here". Give a reason and confirm.
- The **Audit Trail** on each claim records which kind it was (Exception Resolved, Exception Dismissed), with who and
  why. The log is append-only.

### 6. Post to SAP (4:30–5:00)

Back on 0147, *Open exceptions* is now 0. Click **Post to SAP** and confirm. The status becomes **Posted**, and the bar
shows the posting time (ET) and the **MIRO document number**. The trail gains `SAP S/4HANA Integration · Posted to SAP`.
The integration executed the posting, and the row is marked *initiated by Priya Natarajan*.

### 7. `/economics`: is a review worth it? (5:00–5:45)

- The rule is to review a flagged claim when **p × L > c**: probability it is wrong, times the loss if it is, beats the
  cost of a review.
- **Cost curve:** total cost is review cost plus the expected loss left unreviewed. It is lowest at **25 %** review
  capacity, i.e. reviewing everything costs more than reviewing the right quarter.
- **Alert precision by rule:** for each rule, how often reviewers confirmed vs dismissed its alerts. The dismissal from
  step 5 is already counted. This measures precision, not recall.

### 8. `/ask`: grounded questions (5:45–6:30)

Ask the three examples:

1. *Why was CLM-2026-0144 flagged?*
2. *How much did we spend with Lone Star Robotics?*
3. *What should I review first?*

Each answer cites the claims and figures it used. It carries a **Template** badge when it was built from a fixed
template over the database (demo mode), or **Model** when the live model wrote it. The figures come from the database
either way.

### 9. `/audit`: the log (6:30–7:00)

- Filter **Actor** → *Priya Natarajan*: the resolve, the dismissal and the posting she triggered.
- Click **Details** on a row. The drawer shows the full entry, including its metadata JSON: `disposition` on the
  dismissal, `initiatedBy` on the SAP posting, and the `requestId` on both.
- **Export CSV** exports exactly the filtered rows.

### 10. Close: what we measured and what is next (7:00–7:45)

- The grounding chips raise false alarms when the scan is poor. On **harsh** synthetic scans, **55.8 %** of documents had
  at least one critical field flagged "not in the OCR text" even though the extraction was right. On **realistic** scans
  the rate was **15.2 %**, and **12.2 %** after the OCR clean-up the app now ships (`docs/GROUNDING_BENCH.md`).
- 12.2 % is still above our 10 % line. Lowering the risk points would only hide it. The fix is at **intake**: a
  "scan too poor to verify → rescan" state before the audit runs, so reviewers never see alarms caused by bad paper.
  That is the next step, and it is not built yet.

Reset at any time with `pnpm db:seed`.
