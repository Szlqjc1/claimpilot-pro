# Five-minute demo script

Before you start: `pnpm db:reset && pnpm dev`, then open http://localhost:3000. You are redirected to `/login`. **Sign in as `priya.natarajan@ironwood.example` / `Toledo-Controller-26`** (reviewer). No API key is needed; the topbar shows **Demo AI**, your name and your role.

Other demo accounts (all listed in the README):
- `dana.whitfield@ironwood.example` / `Ironwood-Audit-2026` (admin) can do everything a reviewer can.
- `marcus.reed@ironwood.example` / `CrashSled-Request-26` (requester) can submit claims and run the audit, but cannot resolve exceptions or post to SAP.

Resolve/Waive and **Post to SAP** are hidden for anyone who cannot use them, with the reason shown instead. Nobody, reviewer or admin, can resolve or post a claim they submitted themselves. Exceptions that were already handled show who handled them ("by …").

1. **Open `/dashboard`.** Walk through the KPI strip (Total Claim Spend ≈ $3.8M, Auto-Clear ≈ 66%, Avg Cycle Time ≈ 10 h vs the 4.2-day manual baseline), the spend trend, category mix, risk distribution, and the claims list at the bottom (the pending queue is newest first).
2. **Filter Department → Plant Operations.** The KPI cards, charts and list all update, and the URL carries the filter. Click **Reset filters**.
3. **Click CLM-2026-0142**, the newest claim at the top of the list (Midwest Proving Grounds, $14,500).
4. Point out the **Original OEM/Supplier Invoice** on the left and the **Project & Category** card on the right. Note that **AI Structured Data** and the annotated invoice are *not on the page*. There is only a locked placeholder.
5. **Click `🚀 Run AI-RPA Audit`.** The button shows *Running AI-RPA audit…*. When it finishes:
   - the status becomes **Analyzed**,
   - **AI Structured Data** appears (vendor, invoice, date, PO, line items, tax, total, confidence chips, raw JSON),
   - the **AI-Annotated Invoice** appears with green boxes on the same fields,
   - Risk Assessment shows **0/100 · Low · AUTO_APPROVE** (open "How this was calculated").
6. **Audit Trail** (newest first) shows: `AI-RPA Agent` · `Automotive Expense Validated` · `Invoice matched with SAP project code successfully.` On `/audit` the same row reads *initiated by Priya Natarajan* under the actor: the agent executed it, a person triggered it.
7. **Refresh the page.** Everything persists. The button now reads **✅ Audit complete** and is disabled. A repeated API call returns `409 CLAIM_NOT_PENDING`.
8. **Open CLM-2026-0144** (Lone Star Robotics, $56,800). Run the audit. Result: **100 · High · ESCALATE** with three exceptions: Amount Over Limit (R-04), Missing Factory Gate Pass (R-05), PO Balance Exceeded (R-07). Expand the R-07 evidence to show $41,200 remaining and a $15,600 shortfall. The audit trail shows *Automotive Expense Flagged … Routed to Plant Controller.*
9. **Escalated, but not to its own submitter.** The header shows **Assigned · Plant Controller**, not Priya: she is the Plant Controller, but she submitted CLM-2026-0144, and nobody may clear their own claim. The Post to SAP bar says *You submitted this claim, so another reviewer must resolve and post it*, and the Exceptions table has no Resolve/Waive buttons. Leave it for someone else (Dana Whitfield, admin, would find it under **Unassigned** on her `/queue`).
10. **Open CLM-2026-0147** (The Vantage Room Detroit, $2,451.57, submitted by Tyler Brooks). Run the audit: **50 · Medium · REVIEW** with one exception, Entertainment Policy Violation (R-12: $306/head, alcohol, no attendee list). The header now shows **Assigned · Priya Natarajan**: Plant Operations → Plant Controller → Priya, and she did not submit it.
11. **Open `/queue`** (sidebar → **Queue**). Under **Assigned to you**, CLM-2026-0147 is in **Needs disposition** with a **Review** button, next to the other Plant Operations claims routed to Priya. Below, **Unassigned** lists claims nobody owns yet (not audited, clean, or submitted by the role owner); Priya's own submissions such as CLM-2026-0144 are not listed. A requester (Marcus Reed) sees only their own submissions here, read-only.
12. **Clear CLM-2026-0147** (needs a reviewer or admin who did not submit the claim). Click **Review**, then **Resolve** on the R-12 row with a note of at least 10 characters, e.g. *"Attendee list for the LMX-7 launch dinner attached; alcohol approved by plant manager."* The status shows *by Priya Natarajan*, and the audit trail gains `Priya Natarajan · Exception Resolved`. Back on `/queue` the claim has moved to **Ready to post**.
13. **Post to SAP** (reviewer or admin only). With *Open exceptions* at 0, click **Post to SAP** and confirm: the status becomes **Posted**, the bar shows the posting time (ET) and the MIRO document number, and the AI panels stay visible. The audit trail gains `Priya Natarajan · Exceptions Cleared Before Posting` and `SAP S/4HANA Integration · Posted to SAP`. On `/audit` the SAP row shows *initiated by Priya Natarajan* and a green badge. The claim leaves `/queue`.
14. **Open CLM-2026-0145** and run the audit: the system catches the duplicate of BFS-77108 (same vendor, $6,320, posted 2026-10-12). **Stop there.** Do not waive R-03 and post: that would be approving a duplicate payment. Then **open CLM-2026-0146** to show the project-code mismatch (invoice says PRJ-ADAS-Bracket-30) plus the +40.6% SLA bracket price variance.
15. **Back to the dashboard.** Auto-Clear Rate, Exception Rate and High-Risk Exposure have moved, and the KPI Watchlist reflects the new duplicate recovery. Close with the architecture: OCR → LLM extraction → deterministic rules → SAP master data → audit log. DeepSeek runs server-side only, and the demo works with no key.

Reset at any time with `pnpm db:seed`.
