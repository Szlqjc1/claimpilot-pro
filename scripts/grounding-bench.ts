// Grounding benchmark (Task 7) → docs/GROUNDING_BENCH.md + docs/grounding-bench.csv.
// Offline, deterministic, read-only: no DB access, no model calls. Same BENCH_SEED ⇒ same numbers.
//   A. degraded — fixture extraction (correct) vs real Tesseract text of a degraded render → false alarms
//   B. mutated  — one corrupted critical field vs the fixture's clean OCR text → recall, grounding and end-to-end
// Usage: pnpm bench:grounding   (needs ./eng.traineddata; see scripts/degrade.ts)
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { buildSeedPlan, seedRiskInput } from "../src/lib/seed/run";
import { evaluateRisk } from "../src/lib/risk/score";
import { CRITICAL_GROUNDED_FIELDS, groundExtraction } from "../src/lib/ai/grounding";
import { mutationsFor, type Mutation } from "../src/lib/bench/mutate";
import { lowerBound, pct, requiredN, upperBound } from "../src/lib/bench/stats";
import { formatUsd } from "../src/lib/domain/money";
import type { RiskInput } from "../src/lib/risk/types";
import { BASE_SCALE, RENDER_VERSION, degradeCorpus } from "./degrade";

const SEED = Number(process.env.BENCH_SEED ?? 20261105);
const VARIANTS = Number(process.env.BENCH_VARIANTS ?? 5);
const CONTROL_SEED = SEED + 1;
const FIELDS = CRITICAL_GROUNDED_FIELDS;
type Field = (typeof FIELDS)[number];

type Row = Record<string, string | number | boolean>;
const csvRows: Row[] = [];

const withChecks = (input: RiskInput, text: string): RiskInput => ({ ...input, extraction: { ...input.extraction, fieldChecks: groundExtraction(input.extraction, text) } });

async function main() {
  const started = Date.now();
  const plan = buildSeedPlan();
  const log = (m: string) => console.log(m);
  log(`grounding bench · seed ${SEED} · ${VARIANTS} variants/claim · render ${RENDER_VERSION}`);

  // ── A. degraded corpus + undegraded control ─────────────────────────────────────────────────────────────
  const degraded = await degradeCorpus({ seed: SEED, variants: VARIANTS, log });
  const fieldObs: Record<Field, { n: number; fa: number }> = Object.fromEntries(FIELDS.map((f) => [f, { n: 0, fa: 0 }])) as never;
  let docsFa = 0;
  const byBlur: Record<string, { n: number; fa: number }> = {};
  const byScale: Record<string, { n: number; fa: number }> = {};
  let obsA = 0;
  for (const d of degraded) {
    const e = plan.fixtures.get(d.claimId)!.fixture.extraction;
    const checks = groundExtraction(e, d.text);
    let any = false;
    for (const f of FIELDS) {
      if (checks[f] === "not_extracted") continue;
      obsA++;
      fieldObs[f].n++;
      const fa = checks[f] === "not_found";
      if (fa) {
        fieldObs[f].fa++;
        any = true;
      }
      csvRows.push({ population: "A-degraded", doc_id: d.docId, claim_id: d.claimId, field: f, kind: "correct", detail: `blur=${d.params.blurSigma} rot=${d.params.rotateDeg} q=${d.params.jpegQuality} scale=${d.params.scale} contrast=${d.params.contrast}`, grounding: checks[f], flagged: fa, is_error: false, true_decision: "", mutated_decision: "", detected_e2e: "", new_rules: "", exposure_cents: "", ocr_confidence: d.ocrConfidence.toFixed(3) });
    }
    if (any) docsFa++;
    const blurKey = d.params.blurSigma < 1 ? "σ 0.5–1.0" : d.params.blurSigma < 1.5 ? "σ 1.0–1.5" : "σ 1.5–2.0";
    const scaleKey = d.params.scale < 0.6 ? "50–60 %" : "60–70 %";
    for (const [bucket, key] of [[byBlur, blurKey], [byScale, scaleKey]] as const) {
      bucket[key] ??= { n: 0, fa: 0 };
      bucket[key].n++;
      if (any) bucket[key].fa++;
    }
  }
  // Control: same pipeline, no degradation (300 dpi, no blur/rotation, JPEG 95). Shows the pipeline itself is sound.
  const control = await degradeCorpus({ seed: CONTROL_SEED, variants: 1, log, control: true });
  let controlFaDocs = 0;
  let controlObs = 0;
  let controlFaObs = 0;
  for (const d of control) {
    const checks = groundExtraction(plan.fixtures.get(d.claimId)!.fixture.extraction, d.text);
    let any = false;
    for (const f of FIELDS) {
      if (checks[f] === "not_extracted") continue;
      controlObs++;
      if (checks[f] === "not_found") {
        controlFaObs++;
        any = true;
      }
      csvRows.push({ population: "A-control", doc_id: d.docId, claim_id: d.claimId, field: f, kind: "correct", detail: "undegraded 300 dpi, JPEG 95", grounding: checks[f], flagged: checks[f] === "not_found", is_error: false, true_decision: "", mutated_decision: "", detected_e2e: "", new_rules: "", exposure_cents: "", ocr_confidence: d.ocrConfidence.toFixed(3) });
    }
    if (any) controlFaDocs++;
  }

  // ── B. mutated corpus (base claims the engine auto-approves) ───────────────────────────────────────────────
  type Scored = Mutation & { claimId: string; flagged: boolean; trueDecision: string; mutatedDecision: string; detected: boolean; newRules: string[]; exposureCents: number };
  const scored: Scored[] = [];
  let baseClaims = 0;
  for (const c of plan.claims) {
    const input = seedRiskInput(plan, c);
    const text = plan.fixtures.get(c.claimId)!.fixture.ocrText;
    const truth = evaluateRisk(withChecks(input, text));
    if (truth.decision !== "AUTO_APPROVE") continue;
    baseClaims++;
    const trueRules = new Set(truth.findings.map((f) => f.ruleId));
    for (const m of mutationsFor(input.extraction, text)) {
      const mutInput = withChecks({ ...input, extraction: m.extraction }, m.ocrText);
      const r = evaluateRisk(mutInput);
      const newRules = r.findings.map((f) => f.ruleId).filter((id) => !trueRules.has(id));
      const trueTotal = Math.round(input.extraction.total * 100);
      const exposureCents = m.field === "total" ? Math.min(input.claim.amountCents, Math.abs(Math.round(Number(m.extraction.total) * 100) - trueTotal)) : input.claim.amountCents;
      const s: Scored = {
        ...m,
        claimId: c.claimId,
        flagged: mutInput.extraction.fieldChecks?.[m.field] === "not_found",
        trueDecision: truth.decision,
        mutatedDecision: r.decision,
        detected: r.decision !== "AUTO_APPROVE",
        newRules,
        exposureCents,
      };
      scored.push(s);
      csvRows.push({ population: m.isError ? "B-error" : "B-format", doc_id: `${c.claimId}#${m.field}:${m.kind}`, claim_id: c.claimId, field: m.field, kind: m.kind, detail: m.description, grounding: mutInput.extraction.fieldChecks?.[m.field] ?? "", flagged: s.flagged, is_error: m.isError, true_decision: truth.decision, mutated_decision: r.decision, detected_e2e: s.detected, new_rules: newRules.join(" "), exposure_cents: exposureCents, ocr_confidence: "" });
    }
  }
  const errors = scored.filter((s) => s.isError);
  const benign = scored.filter((s) => !s.isError);

  // ── Report ────────────────────────────────────────────────────────────────────────────────────────────────
  const nA = degraded.length;
  const faDocRate = docsFa / nA;
  const faDocUpper = upperBound(docsFa, nA);
  const caught = errors.filter((s) => s.detected);
  const recall = caught.length / errors.length;
  const recallLower = lowerBound(caught.length, errors.length);
  const sumL = errors.reduce((s, x) => s + x.exposureCents, 0);
  const sumLCaught = caught.reduce((s, x) => s + x.exposureCents, 0);
  const groundingFlagged = errors.filter((s) => s.flagged);
  const onlyR14 = caught.filter((s) => s.newRules.length === 1 && s.newRules[0] === "R-14");
  const ruleCounts: Record<string, number> = {};
  for (const s of caught) for (const r of s.newRules) ruleCounts[r] = (ruleCounts[r] ?? 0) + 1;
  const benignFlagged = benign.filter((s) => s.flagged).length;
  const benignMoved = benign.filter((s) => s.detected).length;

  const fmtRate = (k: number, n: number) => (n ? `${k} / ${n} = ${pct(k / n, 1)}` : "—");
  const md: string[] = [];
  md.push(
    "# Grounding benchmark",
    "",
    "Generated by `pnpm bench:grounding` (`scripts/grounding-bench.ts`). Offline and read-only: no database access, no model calls. Same seed ⇒ same numbers.",
    "",
    "| Parameter | Value |",
    "|---|---|",
    `| \`BENCH_SEED\` (degraded corpus) | ${SEED} |`,
    `| Control seed | ${CONTROL_SEED} |`,
    `| Variants per seeded claim | ${VARIANTS} |`,
    `| Render pipeline | \`${RENDER_VERSION}\`: fixture SVG at a 300 dpi base (×${BASE_SCALE.toFixed(3)}), then seeded blur σ 0.5–2 px (output pixels), rotation ±2°, contrast 0.85–1.15, downscale 50–70 %, JPEG quality 40–70; real Tesseract (\`eng\`, LSTM \`best_int\`) |`,
    `| Intervals | exact one-sided 95 % Clopper–Pearson; zero-failure sample sizes \`n = ⌈ln 0.05 / ln target⌉\`: ${requiredN(0.995)} for < 0.5 %, ${requiredN(0.99)} for ≥ 99 % |`,
    "",
    "## The two sentences you can quote",
    "",
    `1. **False alarms.** On ${nA} degraded scans of correctly extracted invoices, grounding flagged at least one critical field as "not in the OCR text" on **${pct(faDocRate, 1)}** of documents (${docsFa} / ${nA}; 95 % upper bound **${pct(faDocUpper, 1)}**), counted per document over ${obsA} field observations clustered by document. On the same ${control.length} documents rendered without degradation it flagged ${pct(controlFaDocs / control.length, 1)} (${controlFaDocs} / ${control.length}).`,
    `2. **Detection.** Of ${errors.length} injected extraction errors on claims the engine otherwise auto-approves, the 18-rule ensemble moved the decision off AUTO_APPROVE for **${pct(recall, 1)}** (${caught.length} / ${errors.length}; 95 % lower bound **${pct(recallLower, 1)}**), or **${pct(sumLCaught / sumL, 1)}** weighted by exposure (${formatUsd(sumLCaught)} of ${formatUsd(sumL)}). Grounding by itself flagged ${pct(groundingFlagged.length / errors.length, 1)} of the errors; that is its contribution, not the system's recall.`,
    "",
    "## A. False alarms on degraded OCR",
    "",
    "The extraction is the fixture, correct by construction; only the OCR text is degraded. Every `not_found` is therefore a false alarm with respect to the extraction (it may still be a true signal that the scan is poor).",
    "",
    "| Field | Field observations | False alarms | Rate | 95 % upper bound |",
    "|---|---:|---:|---:|---:|",
    ...FIELDS.map((f) => `| \`${f}\` | ${fieldObs[f].n} | ${fieldObs[f].fa} | ${pct(fieldObs[f].fa / fieldObs[f].n, 1)} | ${pct(upperBound(fieldObs[f].fa, fieldObs[f].n), 1)} |`),
    `| **Any critical field (per document)** | ${nA} documents | ${docsFa} | **${pct(faDocRate, 1)}** | **${pct(faDocUpper, 1)}** |`,
    `| Control: undegraded render (per document) | ${control.length} documents | ${controlFaDocs} | ${pct(controlFaDocs / control.length, 1)} | ${pct(upperBound(controlFaDocs, control.length), 1)} |`,
    "",
    `Per-field rows count field observations (${obsA} in total); fields within a document are not independent, so only the per-document row supports a population claim. Null fields (e.g. no PO) are \`not_extracted\` and never counted.`,
    "",
    "Document false-alarm rate by degradation strength (dose–response):",
    "",
    "| Blur | Documents | With a false alarm | Rate |",
    "|---|---:|---:|---:|",
    ...Object.entries(byBlur).sort().map(([k, v]) => `| ${k} | ${v.n} | ${v.fa} | ${pct(v.fa / v.n, 1)} |`),
    "",
    "| Downscale | Documents | With a false alarm | Rate |",
    "|---|---:|---:|---:|",
    ...Object.entries(byScale).sort().map(([k, v]) => `| ${k} | ${v.n} | ${v.fa} | ${pct(v.fa / v.n, 1)} |`),
    "",
    "## B. Recall on injected extraction errors",
    "",
    `Base set: the ${baseClaims} seeded claims whose true extraction scores AUTO_APPROVE (an error can only "move the decision" on a claim that would otherwise pass). One error per document; the OCR text is the fixture's clean text. **End-to-end detection** = \`evaluateRisk\` on the mutated extraction (grounding attached) returns REVIEW or ESCALATE.`,
    "",
    "| Field | Kind | Errors | Grounding flagged | End-to-end detected | 95 % lower bound (end-to-end) |",
    "|---|---|---:|---:|---:|---:|",
  );
  for (const f of FIELDS)
    for (const kind of ["absent", "confusable"] as const) {
      const set = errors.filter((s) => s.field === f && s.kind === kind);
      if (!set.length) continue;
      const det = set.filter((s) => s.detected).length;
      md.push(`| \`${f}\` | ${kind} | ${set.length} | ${fmtRate(set.filter((s) => s.flagged).length, set.length)} | ${fmtRate(det, set.length)} | ${pct(lowerBound(det, set.length), 1)} |`);
    }
  for (const kind of ["absent", "confusable"] as const) {
    const set = errors.filter((s) => s.kind === kind);
    const det = set.filter((s) => s.detected).length;
    md.push(`| **all** | **${kind}** | ${set.length} | ${fmtRate(set.filter((s) => s.flagged).length, set.length)} | ${fmtRate(det, set.length)} | ${pct(lowerBound(det, set.length), 1)} |`);
  }
  md.push(
    `| **all** | **all errors** | **${errors.length}** | ${fmtRate(groundingFlagged.length, errors.length)} | **${fmtRate(caught.length, errors.length)}** | **${pct(recallLower, 1)}** |`,
    "",
    "| Recall | Value |",
    "|---|---:|",
    `| Per document (\`caught / all\`) | ${pct(recall, 1)} (95 % lower bound ${pct(recallLower, 1)}) |`,
    `| Exposure-weighted (\`Σ L caught / Σ L all\`) | ${pct(sumLCaught / sumL, 1)} (${formatUsd(sumLCaught)} of ${formatUsd(sumL)}) |`,
    "",
    "Exposure model: an identity error (vendor, invoice number, PO, invoice date) puts the whole invoice at risk (wrong payee, hidden duplicate, wrong PO), so L = the claim amount; a wrong total puts the difference at risk, L = |mutated − true|, capped at the claim amount.",
    "",
    "### Which rule catches what",
    "",
    "Rules that fire on the mutated extraction but not on the true one, counted over detected errors (an error can trigger several):",
    "",
    "| Rule | Errors it newly fires on |",
    "|---|---:|",
    ...Object.entries(ruleCounts).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([r, n]) => `| ${r} | ${n} |`),
    "",
    `- Caught **only** by R-14 (grounding): ${onlyR14.length} of ${caught.length} detected errors.`,
    `- **No rule catches:** ${errors.length - caught.length} of ${errors.length} errors (${pct((errors.length - caught.length) / errors.length, 1)}).`,
    "",
    "Undetected errors by field and kind:",
    "",
    "| Field | Kind | Missed | Example |",
    "|---|---|---:|---|",
  );
  for (const f of FIELDS)
    for (const kind of ["absent", "confusable"] as const) {
      const missed = errors.filter((s) => s.field === f && s.kind === kind && !s.detected);
      if (missed.length) md.push(`| \`${f}\` | ${kind} | ${missed.length} | ${missed[0].description} (${missed[0].claimId}) |`);
    }
  md.push(
    "",
    "## Confusion matrices",
    "",
    "Grounding, per field observation (truth = is the extracted value correct):",
    "",
    "| | flagged `not_found` | not flagged |",
    "|---|---:|---:|",
    `| Correct value, degraded OCR (A) | ${docsFaObs(fieldObs)} | ${obsA - docsFaObs(fieldObs)} |`,
    `| Correct value, undegraded OCR (control) | ${controlFaObs} | ${controlObs - controlFaObs} |`,
    `| Correct value, reformatted (B format) | ${benignFlagged} | ${benign.length - benignFlagged} |`,
    `| Wrong value, absent from the text (B absent) | ${errors.filter((s) => s.kind === "absent" && s.flagged).length} | ${errors.filter((s) => s.kind === "absent" && !s.flagged).length} |`,
    `| Wrong value, present in the text (B confusable) | ${errors.filter((s) => s.kind === "confusable" && s.flagged).length} | ${errors.filter((s) => s.kind === "confusable" && !s.flagged).length} |`,
    "",
    "End-to-end decision, per document (B):",
    "",
    "| | moved to REVIEW/ESCALATE | stayed AUTO_APPROVE |",
    "|---|---:|---:|",
    `| Injected error | ${caught.length} | ${errors.length - caught.length} |`,
    `| Benign reformatting | ${benignMoved} | ${benign.length - benignMoved} |`,
    "",
    "## Limits",
    "",
    "- **Grounding cannot detect OCR-level errors, by construction.** Its input is the OCR text. If Tesseract reads 5 as 6 and the extractor copies it faithfully, the value is grounded and wrong. That class is covered by R-10 (totals reconciliation), R-07 (PO lookup), R-08 (benchmark prices) and human review, not by R-14. No grounding recall figure is reported against OCR errors.",
    "- **No seeded claim exercises `not_found`.** Every seeded value appears in its own OCR text (`src/tests/grounding.test.ts`), which is exactly why this benchmark generates its own errors and degraded scans.",
    "- **Confusable errors are the hard case.** They are present in the text, so grounding cannot see them; whether they are caught depends entirely on the other rules (see the tables above).",
    "- **Why confusable vendor / invoice-number / PO errors are never caught here.** The rules read the vendor and the PO from the claim row and SAP master data (`claim.vendorName`, `claim.poNumber`), not from the extraction, so on a seeded claim an extraction error in those fields cannot move any rule except R-14. The invoice number does feed R-03 from the extraction, but a confused invoice number only matters if it collides with another claim's. On an upload, where the claim row lacks these fields, the extraction is used and the outcome can differ.",
    "- **Absent errors are caught at 100 % by construction:** the mutation is only kept if grounding reports it `not_found`. That row proves the wiring (grounding → R-14 → REVIEW), not a recall figure for real extractor mistakes.",
    "- The degraded corpus measures this renderer and these degradation ranges on these 130 synthetic layouts with Tesseract; real scans differ. The false-alarm rate is a property of the OCR quality as much as of grounding.",
    "- The base claims are synthetic and share layouts; documents from the same claim (5 variants) are not independent of each other either, so treat the per-document bound as optimistic.",
    "- The model extractor is not exercised (no DeepSeek calls): this benchmark measures grounding and the rule ensemble given an extraction, not the extractor's error rate.",
    "",
  );
  await writeFile(path.resolve("docs/GROUNDING_BENCH.md"), md.join("\n"));

  const cols = ["population", "doc_id", "claim_id", "field", "kind", "detail", "grounding", "flagged", "is_error", "true_decision", "mutated_decision", "detected_e2e", "new_rules", "exposure_cents", "ocr_confidence"];
  const esc = (v: unknown) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  await writeFile(path.resolve("docs/grounding-bench.csv"), [cols.join(","), ...csvRows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n") + "\n");

  log("");
  log(md.slice(0, md.indexOf("## A. False alarms on degraded OCR")).join("\n"));
  log(`Wrote docs/GROUNDING_BENCH.md and docs/grounding-bench.csv (${csvRows.length} rows) in ${Math.round((Date.now() - started) / 1000)} s.`);
}

const docsFaObs = (o: Record<string, { n: number; fa: number }>) => Object.values(o).reduce((s, v) => s + v.fa, 0);

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
