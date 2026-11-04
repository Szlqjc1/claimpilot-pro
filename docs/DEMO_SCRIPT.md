# Five-minute demo script

Before you start: `pnpm db:reset && pnpm dev`, then open http://localhost:3000. No API key is needed; the topbar shows **Demo AI**.

1. **Open `/dashboard`.** Walk through the KPI strip (Total Claim Spend ≈ $3.8M, Auto-Clear ≈ 66%, Avg Cycle Time ≈ 10 h vs the 4.2-day manual baseline), the spend trend, category mix, risk distribution, and the claims list at the bottom (the pending queue is newest first).
2. **Filter Department → Plant Operations.** The KPI cards, charts and list all update, and the URL carries the filter. Click **Reset filters**.
3. **Click CLM-2026-0142**, the newest claim at the top of the list (Midwest Proving Grounds, $14,500).
4. Point out the **Original OEM/Supplier Invoice** on the left and the **Project & Category** card on the right. Note that **AI Structured Data** and the annotated invoice are *not on the page*. There is only a locked placeholder.
5. **Click `🚀 Run AI-RPA Audit`.** The button shows *Running AI-RPA audit…*. When it finishes:
   - the status becomes **Analyzed**,
   - **AI Structured Data** appears (vendor, invoice, date, PO, line items, tax, total, confidence chips, raw JSON),
   - the **AI-Annotated Invoice** appears with green boxes on the same fields,
   - Risk Assessment shows **0/100 · Low · AUTO_APPROVE** (open "How this was calculated").
6. **Audit Trail** (newest first) shows: `AI-RPA Agent` · `Automotive Expense Validated` · `Invoice matched with SAP project code successfully.`
7. **Refresh the page.** Everything persists. The button now reads **✅ Audit complete** and is disabled. A repeated API call returns `409 CLAIM_NOT_PENDING`.
8. **Open CLM-2026-0144** (Lone Star Robotics, $56,800). Run the audit. Result: **100 · High · ESCALATE** with three exceptions: Amount Over Limit (R-04), Missing Factory Gate Pass (R-05), PO Balance Exceeded (R-07). Expand the R-07 evidence to show $41,200 remaining and a $15,600 shortfall. The audit trail shows *Automotive Expense Flagged … Routed to Plant Controller.*
9. **Handle the exceptions on CLM-2026-0144.** In the Exceptions table, click **Resolve** (or **Waive**) on each row and enter a resolution note of at least 10 characters, e.g. *"Gate pass GP-TOL-30511 found in yard log; PO 4500871 change order approved."* Each one adds an audit-trail entry: `AP Shared Services · Exception Resolved` (or `Exception Waived`) with the rule ID and note.
10. **Post to SAP.** When *Open exceptions* reaches 0, the **Post to SAP** bar unlocks. Confirm the dialog: the status becomes **Posted**, the bar shows the posting time (ET) and the MIRO document number, and the AI panels stay visible. The audit trail gains two entries: `AP Shared Services · Exceptions Resolved` and `SAP S/4HANA Integration · Posted to SAP` (*Invoice LSRI-2026-0417 posted (MIRO) for $56,800.00; payment run Net 60.*).
11. **Open CLM-2026-0145** to show the duplicate of BFS-77108 (same vendor, $6,320, posted 2026-10-12). Then **open CLM-2026-0146** to show the project-code mismatch (invoice says PRJ-ADAS-Bracket-30) plus the +40.6% SLA bracket price variance.
12. **Back to the dashboard.** Auto-Clear Rate, Exception Rate and High-Risk Exposure have moved, and the KPI Watchlist reflects the new duplicate recovery. Close with the architecture: OCR → LLM extraction → deterministic rules → SAP master data → audit log. DeepSeek runs server-side only, and the demo works with no key.

Reset at any time with `pnpm db:seed`.
