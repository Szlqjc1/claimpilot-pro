# AI governance

ClaimPilot PRO uses a language model in a payment-approval system. The model may **phrase** facts; it is never a
**source** of facts, scores or decisions. This page is the boundary (DECISIONS D-36; see also
[ARCHITECTURE.md](ARCHITECTURE.md) and [ECONOMICS.md](ECONOMICS.md)).

## Who does what

| Task | Who does it | Where the facts come from | How it is verified |
|---|---|---|---|
| **Extraction** (invoice → structured data) | OCR produces text and geometry; DeepSeek structures the text (live), or the seeded fixture (mock) | The document's OCR text only; images are never sent | Zod schema with one repair pass; geometry and confidence always from OCR, never the model; every field grounded against the OCR text; seeded claims score on the reference fixture with the model as a recorded shadow (D-37) |
| **Judgement** (score, level, decision, routing, review economics) | Deterministic code: `src/lib/risk`, `src/lib/domain/routing.ts`, `src/lib/risk/economics.ts` | SAP master data, policy, the extraction | Pure functions with table-driven tests; the model never sets a score |
| **Narrative** (finding summary on the claim) | DeepSeek (live) or a template (mock) | The deterministic findings JSON | Prompt forbids adding findings or changing the score; template fallback |
| **Q&A** (`/ask`) | Deterministic retrieval + template; DeepSeek may rephrase (live) | `Facts` read from the database by `src/lib/ask/retrieve.ts` | Citation check on every claim id, rule id and dollar amount; template fallback |

## The two rules the Q&A obeys

1. **Retrieval before generation.** The intent is detected with deterministic rules (claim id pattern, keyword
   sets, vendor / category / department names matched against rows already loaded). The facts are read from the
   database into a typed, size-capped `Facts` object *before* any model is involved. The model receives only the
   question and that JSON.
2. **Refuse when the data is missing.** An unknown claim id, an unmatched vendor or a category without a policy
   row produces "I do not have …", never a guess. Questions outside the five supported intents get a fixed
   refusal: *I can only answer questions about claim status, vendor spend, policy limits and current priorities.*

## The citation rule

In live mode, the model's answer is kept only if every `CLM-####-####` and `R-##` token in it, and every dollar
amount, already appears in the serialised `Facts`. Otherwise the model text is discarded and the deterministic
template is returned, marked `source: "template"` so the fallback is visible in the UI (*Template* badge). The
model therefore cannot introduce a claim id, a rule id or an amount that was not retrieved; the prompt also tells
it to copy amounts exactly and not to compute new numbers. `citations` (rendered as *Sources* links) are the ids
the answer relies on.

## Why it works with no API key

Every intent has a template answer built only from `Facts`: no model, no network. In `AI_MODE=mock` that
template *is* the answer; in live mode it is the fallback for a missing key, a provider error, a malformed
response or a failed citation check. Live mode with no key at all returns `503 AI_NOT_CONFIGURED`, the same
convention as the KPI explanation.

## What is recorded

Each question writes one audit row: actor = the user who asked, action `AI Answer`, details = the question
text, metadata `{ requestId, kind, source, citations }`. The answer and the retrieved data are not stored; the
Q&A writes nothing else.

## Limits

- Five intents only; the keyword rules are simple and will miss paraphrases (which then get the refusal).
- The citation check covers ids and dollar amounts, not other numbers (counts, percentages, dates); the prompt
  forbids inventing them, and the template path is unaffected.
- Every signed-in user may ask about any claim, as on the rest of the app (D-27 restricts actions, not reads).
