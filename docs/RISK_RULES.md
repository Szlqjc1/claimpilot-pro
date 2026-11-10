# Risk rules

The risk engine (`src/lib/risk/`) is **pure, synchronous and deterministic**. `evaluateRisk(input)` takes the claim, the extraction, and SAP master data (vendor, PO, GRN, policy, project, benchmarks, 90-day vendor history) and returns `{ score, riskLevel, decision, findings }`. It makes no network calls, and the LLM never sees or changes the score.

## Rules

| ID | Rule | Points | Severity | Anomaly type | Example |
|---|---|---:|---|---|---|
| R-01 | Project code missing on the claim, or missing on the invoice with no PO linking it to a project (when policy requires one) | 40 | High | Missing Project Code | Historical logistics claim with no SAP project |
| R-02 | Invoice or PO project code differs from the claim's | 40 | High | Missing Project Code | **CLM-0146**: invoice says PRJ-ADAS-Bracket-30, claim is -31 |
| R-03 | Duplicate supplier invoice: same normalized vendor + invoice number, or same vendor + amount within 2% within 90 days | 60 | High | Duplicate Supplier Invoice | **CLM-0145**: $6,320 matches BFS-77108 posted 2026-10-12 |
| R-04 | Amount over the category limit (>100% → High 40). 80–100% with no PO → Medium 20 (see DECISIONS D-01) | 40 / 20 | High / Medium | Amount Over Limit | **CLM-0144**: $56,800 vs $50,000 MRO limit |
| R-05 | Required GRN / factory gate pass not found in SAP | 30 | High | Missing Factory Gate Pass | **CLM-0144**: no GRN on PO 4500871 |
| R-06 | Vendor not approved, W-9 missing or expired, or insurance expired | 35 | High | Vendor Not Approved | **CLM-0148**: Great Lakes Die & Tool W-9 expired 2026-08-31 |
| R-07 | No PO where required, or invoice exceeds the PO remaining balance (amount − previously consumed) | 30 | High | PO Balance Exceeded | **CLM-0144**: $56,800 vs $41,200 remaining; **CLM-0148**: $128,400 vs $40,000 |
| R-08 | Unit price vs benchmark p50: >30% → 25, 15–30% → 15 | 25 / 15 | Medium | Price Variance vs Benchmark | **CLM-0146**: SLA bracket $450 vs $320 p50 (+40.6%) |
| R-09 | ≥2 invoices from one vendor within 7 days, each 80–99% of the limit | 25 | Medium | Split Invoice Suspected | Historical freight pair at 86% / 93% |
| R-10 | Totals off by more than $1, or tax rate implausible for the ship-to state | 20 | Medium | Tax Calculation Mismatch | 7.5% tax on a Michigan ship-to (MI is 6%) |
| R-11 | Travel: lodging > $184/night, airfare > $650, non-economy fare, per diem > $74 | 25 | Medium | Travel Policy Violation | **CLM-0143**: lodging $250/night |
| R-12 | Entertainment: > $150/head (+25), alcohol (+10), no attendee list (+15) | ≤ 50 | Medium | Entertainment Policy Violation | **CLM-0147**: $306/head + wine + no list = 50 |
| R-13 | Invoice dated after submission, after project end, or a weekend business meal | 15 | Low | Invoice Date Anomaly | Saturday dinner |
| R-14 | A **non-null** critical field (vendor, invoice #, invoice date, PO, total) that either (1) is **not found in the OCR text** (deterministic grounding, `src/lib/ai/grounding.ts`), or (2) has **OCR-layer confidence < 0.75** (fixture value for seeded claims, Tesseract page confidence for uploads). (3) **D-44:** is null although its label is on the document (presence `unreadable`) and the field is **required** for this claim (an optional field never escalates, D-45). 15 per flagged field, capped at 30. A field the document does not have (presence `absent`) never fires it. Message: *Scan too poor to verify `<field>` — rescan or check this field manually.* The model's self-reported confidence is **never** used. Grounding cannot catch an OCR misread that the extractor copies faithfully (the value is in the text and wrong); that class is left to R-10 / R-07 / R-08 and human review (D-37) | 15–30 | Low | Low OCR Confidence | Total read at 0.68 |
| R-15 | Approval missing or below the matrix level (<$10k Manager, <$50k Director, <$250k VP, else CFO) | 20 | Medium | Approval Threshold Breach | $22k signed by a Manager |
| R-16 | Currency not USD | 15 | Low | Currency/FX Mismatch | — |
| R-17 | Remit-to bank differs from the vendor master | 50 | High | Bank Detail Change | Historical "Fifth Coast Bank ••6672" |
| R-18 | Tooling/software > $5,000 on an expense-coded PO | 20 | Medium | Capitalization Mismatch | CAE licenses on an Expense PO |
| R-19 | **Incomplete or conflicting extraction (D-44).** A **required** critical field is `absent` from the invoice, or any critical field is `conflict` (the document gives two different values). `unreadable` is R-14's, never R-19's. Required: vendor, invoice #, invoice date and total always; PO only from **$1,000** on procurement categories (never on Supplier Audit Travel or Client Entertainment) | 20 | High | Incomplete or Conflicting Extraction | Synthetic upload: $14,500 procurement invoice with no PO line |
| R-20 | **Invoice does not match the claim (D-46).** The extraction disagrees with what the claim records, after normalisation: vendor vs `Claim.vendorName`, invoice # vs `Claim.invoiceNumber`, PO vs `Claim.poNumber` (including a PO on the invoice that the claim does not reference), total vs the claimed amount (exact cents). A missing value on either side never fires. One finding lists every mismatch. Catches what grounding cannot: a value that is in the OCR text but wrong (a vendor name cut by a line wrap, an OCR digit insertion) | 25 / 40 | Medium / High (total) | Invoice Does Not Match Claim | Variant benchmark: vendor "Buckeye Fastener" on a Buckeye Fastener Supply claim |

## Field presence (R-14 and R-19, D-44)

Before scoring, every critical field gets one presence state (`src/lib/ai/presence.ts`), from the extracted value, its
grounding, and whether the field's **label** is on the document (`src/lib/ai/labels.ts`: English and Chinese aliases,
case-, dash- and whitespace-insensitive):

| State | When | Routing |
|---|---|---|
| `present` | value extracted **and** found in the OCR text | none |
| `unreadable` | value extracted but **not** in the OCR text, **or** no value although the label is there | **R-14** (Low, 15/field, cap 30): rescan. A label with no value fires only on a **required** field |
| `absent` | no value and no label, or the label is followed by a standalone empty marker (`PO Number: —`, `N/A`, `none`, also mid-line as OCR flattens a table row: `PO Number: — Release: —`) | **R-19** (High, 20) only if the field is required; otherwise nothing |
| `conflict` | the extractor reports two or more different values for the field | **R-19** (High, 20) |

Required vs optional (`src/lib/domain/field-policy.ts`): vendor, invoice #, invoice date and total are always required.
A PO is required at **$1,000** and above on procurement categories; Supplier Audit Travel and Client Entertainment never
require one. Due date, project reference and tax ID are optional and never escalate.

R-07 and R-19 can both fire on a missing PO; they read different things. R-07 checks the claim against SAP (no PO on
the claim where policy requires one, or a PO without enough balance); R-19 checks the invoice document itself.

**R-19 is never exercised by the demo data.** All 15 seeded claims without a PO number are Supplier Audit Travel or
Client Entertainment, and their invoices say `PO Number: —`, so the PO is `absent` and not required; every other
critical field on all 130 seeded claims is `present`. R-19 is covered by unit tests and one synthetic case (a $14,500
procurement invoice with its PO line removed → R-19, ESCALATE) in `src/tests/presence.test.ts`.

## Scoring and decision

1. Sum the points and cap at 100.
2. Score band: 0–24 Low, 25–59 Medium, 60–100 High.
3. **Severity floor:** final level = max(band, highest finding severity). A single High finding always means High.
4. Decision: High → `ESCALATE`, Medium → `REVIEW`, Low → `AUTO_APPROVE` only with zero findings (otherwise `REVIEW`).
5. One `Exceptions` row per finding (unique on `Claim_ID + ruleId`), with rule ID, points, message and JSON evidence.

## Hero results (unit-tested in `src/tests/risk.test.ts`)

| Claim | Score | Level | Decision | Rules |
|---|---:|---|---|---|
| CLM-2026-0142 | 0 | Low | AUTO_APPROVE | — |
| CLM-2026-0143 | 25 | Medium | REVIEW | R-11 |
| CLM-2026-0144 | 100 | High | ESCALATE | R-04, R-05, R-07 |
| CLM-2026-0145 | 60 | High | ESCALATE | R-03 |
| CLM-2026-0146 | 65 | High | ESCALATE | R-02, R-08 |
| CLM-2026-0147 | 50 | Medium | REVIEW | R-12 |
| CLM-2026-0148 | 65 | High | ESCALATE | R-06, R-07 |

The seed also asserts these before writing anything, so a rule change that breaks them fails `pnpm db:seed`.

## Where to change thresholds

- Category limits, PO/GRN/project requirements: `src/lib/seed/master.ts` → `POLICIES` (reseed afterwards).
- Travel/entertainment caps, approval matrix, capitalization threshold, state tax ranges: `src/lib/domain/constants.ts`.
- Rule logic and points: `src/lib/risk/rules.ts`. Bands and decision: `src/lib/risk/score.ts`.
