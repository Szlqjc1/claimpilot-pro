// Grounding benchmark (Tasks 7 / 7b) → docs/GROUNDING_BENCH.md + docs/grounding-bench.csv.
// Offline, deterministic, read-only: no DB access, no model calls. Same BENCH_SEED ⇒ same numbers.
//   A. degraded — fixture extraction (correct) vs real Tesseract text of a degraded render → false alarms,
//      for two profiles (harsh, realistic) and three OCR paths (raw, grayscale clean-up, binarised clean-up)
//   B. mutated  — one corrupted critical field vs the fixture's clean OCR text → recall, grounding and end-to-end
// Usage: pnpm bench:grounding   (needs ./eng.traineddata; see scripts/degrade.ts)
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { buildSeedPlan, seedRiskInput } from "../src/lib/seed/run";
import { evaluateRisk } from "../src/lib/risk/score";
import { CRITICAL_GROUNDED_FIELDS, groundExtraction } from "../src/lib/ai/grounding";
import { mutationsFor, type Mutation } from "../src/lib/bench/mutate";
import { PROFILE_RANGES } from "../src/lib/bench/prng";
import { lowerBound, pct, requiredN, upperBound } from "../src/lib/bench/stats";
import { formatUsd } from "../src/lib/domain/money";
import { OCR_PIPELINE, OCR_PREP_VERSION, type PrepMode, type Psm } from "../src/lib/ai/ocr-prep";
import type { RiskInput } from "../src/lib/risk/types";
import { PROFILE_BASE, RAW, RENDER_VERSION, degradeCorpus, ocrVersion, variantLabel, type DegradedDoc, type OcrVariant, type Profile } from "./degrade";

const SEED = Number(process.env.BENCH_SEED ?? 20261105);
const VARIANTS = Number(process.env.BENCH_VARIANTS ?? 5);
const CONTROL_SEED = SEED + 1;
const FIELDS = CRITICAL_GROUNDED_FIELDS;
type Field = (typeof FIELDS)[number];
/** Part C trigger (Task 7b): above this realistic false-alarm rate, report and stop. */
const PART_C_LIMIT = 0.1;

type Row = Record<string, string | number | boolean>;
const csvRows: Row[] = [];

const withChecks = (input: RiskInput, text: string): RiskInput => ({ ...input, extraction: { ...input.extraction, fieldChecks: groundExtraction(input.extraction, text) } });

type Base = { input: RiskInput; cleanText: string; errors: Mutation[] };

type FaStats = {
  profile: Profile;
  ocr: OcrVariant;
  docs: number;
  docsFa: number;
  obs: number;
  obsFa: number;
  fieldObs: Record<Field, { n: number; fa: number }>;
  meanWords: number;
  meanWordConf: number;
  meanOcrConf: number;
  prepFallbacks: number;
  byBlur: Record<string, { n: number; fa: number }>;
  e2eDocs: number;
  e2eMoved: number;
  detN: number;
  detCaught: number;
};

/** False alarms of grounding (and of the end-to-end decision) on correct extractions read from degraded OCR. */
function analyse(docs: DegradedDoc[], profile: Profile, ocr: OcrVariant, plan: ReturnType<typeof buildSeedPlan>, base: Map<string, Base>, csv: boolean): FaStats {
  const fieldObs = Object.fromEntries(FIELDS.map((f) => [f, { n: 0, fa: 0 }])) as Record<Field, { n: number; fa: number }>;
  const s: FaStats = { profile, ocr, docs: docs.length, docsFa: 0, obs: 0, obsFa: 0, fieldObs, meanWords: 0, meanWordConf: 0, meanOcrConf: 0, prepFallbacks: 0, byBlur: {}, e2eDocs: 0, e2eMoved: 0, detN: 0, detCaught: 0 };
  const blurEdges = profile === "realistic" ? [0.5, 0.75] : [1, 1.5];
  for (const d of docs) {
    const e = plan.fixtures.get(d.claimId)!.fixture.extraction;
    const checks = groundExtraction(e, d.text);
    let any = false;
    for (const f of FIELDS) {
      if (checks[f] === "not_extracted") continue;
      s.obs++;
      fieldObs[f].n++;
      const fa = checks[f] === "not_found";
      if (fa) {
        fieldObs[f].fa++;
        s.obsFa++;
        any = true;
      }
      if (csv)
        csvRows.push({ population: profile === "control" ? "A-control" : "A-degraded", profile, ocr_pipeline: ocrVersion(ocr), doc_id: d.docId, claim_id: d.claimId, field: f, kind: "correct", detail: `blur=${d.params.blurSigma} rot=${d.params.rotateDeg} q=${d.params.jpegQuality} scale=${d.params.scale} contrast=${d.params.contrast}`, grounding: checks[f], flagged: fa, is_error: false, true_decision: "", mutated_decision: "", detected_e2e: "", new_rules: "", exposure_cents: "", ocr_confidence: d.ocrConfidence.toFixed(3), word_count: d.wordCount, mean_word_confidence: d.meanWordConfidence.toFixed(4) });
    }
    if (any) s.docsFa++;
    s.meanWords += d.wordCount;
    s.meanWordConf += d.meanWordConfidence;
    s.meanOcrConf += d.ocrConfidence;
    if (d.prep && !d.prep.preprocessed) s.prepFallbacks++;
    const key = d.params.blurSigma < blurEdges[0] ? `σ < ${blurEdges[0]}` : d.params.blurSigma < blurEdges[1] ? `σ ${blurEdges[0]}–${blurEdges[1]}` : `σ ≥ ${blurEdges[1]}`;
    s.byBlur[key] ??= { n: 0, fa: 0 };
    s.byBlur[key].n++;
    if (any) s.byBlur[key].fa++;

    // End-to-end on base claims (true extraction auto-approves on clean text).
    const b = base.get(d.claimId);
    if (!b) continue;
    s.e2eDocs++;
    const truth = evaluateRisk(withChecks(b.input, d.text));
    if (truth.decision !== "AUTO_APPROVE") {
      s.e2eMoved++;
      continue;
    }
    // Detection on the degraded text, only where the correct extraction still passes (so a false alarm can never
    // be counted as a detection). One variant per claim keeps the sample independent of the corpus size.
    if (d.variant !== 0) continue;
    for (const m of b.errors) {
      s.detN++;
      if (evaluateRisk(withChecks({ ...b.input, extraction: m.extraction }, d.text)).decision !== "AUTO_APPROVE") s.detCaught++;
    }
  }
  s.meanWords /= Math.max(1, docs.length);
  s.meanWordConf /= Math.max(1, docs.length);
  s.meanOcrConf /= Math.max(1, docs.length);
  return s;
}

const better = (a: FaStats, b: FaStats) => (a.docsFa !== b.docsFa ? a.docsFa < b.docsFa : a.meanWordConf > b.meanWordConf);

async function main() {
  const started = Date.now();
  const plan = buildSeedPlan();
  const log = (m: string) => console.log(m);
  log(`grounding bench · seed ${SEED} · ${VARIANTS} variants/claim · render ${RENDER_VERSION} · prep ${OCR_PREP_VERSION}`);

  // Base claims and their injected errors (from clean text), shared by A's end-to-end checks and by B.
  const base = new Map<string, Base>();
  for (const c of plan.claims) {
    const input = seedRiskInput(plan, c);
    const cleanText = plan.fixtures.get(c.claimId)!.fixture.ocrText;
    if (evaluateRisk(withChecks(input, cleanText)).decision !== "AUTO_APPROVE") continue;
    base.set(c.claimId, { input, cleanText, errors: mutationsFor(input.extraction, cleanText).filter((m) => m.isError) });
  }

  // ── A0. PSM 3 vs 6, per OCR path, on the realistic profile (one variant per claim = 130 documents) ──────────
  const psmTrials: FaStats[] = [];
  for (const prep of ["off", "gray", "binary"] as PrepMode[])
    for (const psm of ["3", "6"] as Psm[]) {
      const ocr = { prep, psm };
      psmTrials.push(analyse(await degradeCorpus({ seed: SEED, variants: 1, profile: "realistic", ocr, log }), "realistic", ocr, plan, base, false));
    }
  const bestPsm = (prep: PrepMode): Psm => psmTrials.filter((t) => t.ocr.prep === prep).reduce((a, b) => (better(a, b) ? a : b)).ocr.psm as Psm;
  const pipelines: OcrVariant[] = [RAW, { prep: "gray", psm: bestPsm("gray") }, { prep: "binary", psm: bestPsm("binary") }];

  // ── A. full degraded corpora: two profiles × three OCR paths, plus the undegraded control ─────────────────────
  const runs: FaStats[] = [];
  for (const profile of ["harsh", "realistic"] as Profile[])
    for (const ocr of pipelines) runs.push(analyse(await degradeCorpus({ seed: SEED, variants: VARIANTS, profile, ocr, log }), profile, ocr, plan, base, true));
  const control = analyse(await degradeCorpus({ seed: CONTROL_SEED, variants: 1, profile: "control", log }), "control", RAW, plan, base, true);
  const run = (profile: Profile, prep: PrepMode) => runs.find((r) => r.profile === profile && r.ocr.prep === prep)!;
  const harshRaw = run("harsh", "off");
  const realRaw = run("realistic", "off");
  const realBest = runs.filter((r) => r.profile === "realistic").reduce((a, b) => (better(a, b) ? a : b));
  const recommended: OcrVariant = realBest.ocr.prep !== "off" && realBest.docsFa < realRaw.docsFa ? realBest.ocr : RAW;
  const realApp = runs.find((r) => r.profile === "realistic" && ocrVersion(r.ocr) === ocrVersion(OCR_PIPELINE.mode === "off" ? RAW : { prep: OCR_PIPELINE.mode, psm: OCR_PIPELINE.psm }));
  const partCRate = (realApp ?? realRaw).docsFa / (realApp ?? realRaw).docs;

  // ── B. mutated corpus (unchanged from Task 7) ───────────────────────────────────────────────────────────────
  type Scored = Mutation & { claimId: string; flagged: boolean; trueDecision: string; mutatedDecision: string; detected: boolean; newRules: string[]; exposureCents: number };
  const scored: Scored[] = [];
  for (const c of plan.claims) {
    const b = base.get(c.claimId);
    if (!b) continue;
    const truth = evaluateRisk(withChecks(b.input, b.cleanText));
    const trueRules = new Set(truth.findings.map((f) => f.ruleId));
    for (const m of mutationsFor(b.input.extraction, b.cleanText)) {
      const mutInput = withChecks({ ...b.input, extraction: m.extraction }, m.ocrText);
      const r = evaluateRisk(mutInput);
      const newRules = r.findings.map((f) => f.ruleId).filter((id) => !trueRules.has(id));
      const trueTotal = Math.round(b.input.extraction.total * 100);
      const exposureCents = m.field === "total" ? Math.min(b.input.claim.amountCents, Math.abs(Math.round(Number(m.extraction.total) * 100) - trueTotal)) : b.input.claim.amountCents;
      const s: Scored = { ...m, claimId: c.claimId, flagged: mutInput.extraction.fieldChecks?.[m.field] === "not_found", trueDecision: truth.decision, mutatedDecision: r.decision, detected: r.decision !== "AUTO_APPROVE", newRules, exposureCents };
      scored.push(s);
      csvRows.push({ population: m.isError ? "B-error" : "B-format", profile: "clean", ocr_pipeline: "fixture", doc_id: `${c.claimId}#${m.field}:${m.kind}`, claim_id: c.claimId, field: m.field, kind: m.kind, detail: m.description, grounding: mutInput.extraction.fieldChecks?.[m.field] ?? "", flagged: s.flagged, is_error: m.isError, true_decision: truth.decision, mutated_decision: r.decision, detected_e2e: s.detected, new_rules: newRules.join(" "), exposure_cents: exposureCents, ocr_confidence: "", word_count: "", mean_word_confidence: "" });
    }
  }
  const errors = scored.filter((s) => s.isError);
  const benign = scored.filter((s) => !s.isError);
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

  // ── Report ────────────────────────────────────────────────────────────────────────────────────────────────
  const rate = (k: number, n: number) => (n ? pct(k / n, 1) : "—");
  const fmtRate = (k: number, n: number) => (n ? `${k} / ${n} = ${pct(k / n, 1)}` : "—");
  const docFa = (r: FaStats) => `${rate(r.docsFa, r.docs)} (≤ ${pct(upperBound(r.docsFa, r.docs), 1)})`;
  const ranges = (p: "harsh" | "realistic") => {
    const r = PROFILE_RANGES[p];
    return `${Math.round(PROFILE_BASE[p] * 1200 * (300 / 2550))} dpi base, blur σ ${r.blur[0]}–${r.blur[1]} px, rotation ±${r.rotate}°, JPEG ${r.jpeg[0]}–${r.jpeg[1]}, downscale ${r.scale[0] * 100}–${r.scale[1] * 100} %, contrast ${r.contrast[0]}–${r.contrast[1]}`;
  };
  const md: string[] = [];
  md.push(
    "# Grounding benchmark",
    "",
    "Generated by `pnpm bench:grounding` (`scripts/grounding-bench.ts`). Offline and read-only: no database access, no model calls. Same seed ⇒ same numbers.",
    "",
    `Pipeline: illumination normalisation ${OCR_PIPELINE.illumination ? "on" : "off"} (D-52), rectification off (D-50; flat renders). Applies to every table below; OCR clean-up \`${OCR_PREP_VERSION}\`.`,
    "",
    "| Parameter | Value |",
    "|---|---|",
    `| \`BENCH_SEED\` (degraded corpora) | ${SEED} |`,
    `| Control seed | ${CONTROL_SEED} |`,
    `| Variants per seeded claim | ${VARIANTS} (130 claims → ${130 * VARIANTS} documents per profile) |`,
    `| Profile \`harsh\` (Task 7, worst case) | ${ranges("harsh")} |`,
    `| Profile \`realistic\` (Task 7b) | ${ranges("realistic")} |`,
    `| Pipelines | render \`${RENDER_VERSION}\`; preprocessing \`${OCR_PREP_VERSION}\` (\`src/lib/ai/preprocess.ts\`: grayscale, deskew ±3°, 2× upscale, then Otsu / 32 px tiled threshold, or left as grayscale); real Tesseract (\`eng\`, LSTM \`best_int\`). Blur σ is applied in output pixels. |`,
    `| Intervals | exact one-sided 95 % Clopper–Pearson; zero-failure sample sizes \`n = ⌈ln 0.05 / ln target⌉\`: ${requiredN(0.995)} for < 0.5 %, ${requiredN(0.99)} for ≥ 99 % |`,
    "",
    "## The sentences you can quote",
    "",
    `1. **False alarms, raw OCR (what the app does today).** Grounding flagged at least one critical field as "not in the OCR text" on **${rate(realRaw.docsFa, realRaw.docs)}** of ${realRaw.docs} realistic scans (95 % upper bound **${pct(upperBound(realRaw.docsFa, realRaw.docs), 1)}**) and on **${rate(harshRaw.docsFa, harshRaw.docs)}** of ${harshRaw.docs} harsh scans (≤ ${pct(upperBound(harshRaw.docsFa, harshRaw.docs), 1)}), counted per document; undegraded control: ${control.docsFa} / ${control.docs}.`,
    `2. **After clean-up.** The best clean-up on the realistic profile (${variantLabel(realBest.ocr)}) gives **${rate(realBest.docsFa, realBest.docs)}** (≤ ${pct(upperBound(realBest.docsFa, realBest.docs), 1)}); binarisation, as specified, gives ${rate(run("realistic", "binary").docsFa, realRaw.docs)} realistic and ${rate(run("harsh", "binary").docsFa, harshRaw.docs)} harsh.`,
    `3. **Detection.** Of ${errors.length} injected extraction errors on claims the engine otherwise auto-approves, the 18-rule ensemble moved the decision off AUTO_APPROVE for **${pct(recall, 1)}** (${caught.length} / ${errors.length}; 95 % lower bound **${pct(recallLower, 1)}**), or **${pct(sumLCaught / sumL, 1)}** weighted by exposure (${formatUsd(sumLCaught)} of ${formatUsd(sumL)}). Grounding by itself flagged ${pct(groundingFlagged.length / errors.length, 1)} of the errors; that is its contribution, not the system's recall.`,
    "",
    `**Part C decision.** The realistic false-alarm rate with the pipeline the app ships (\`${OCR_PIPELINE.mode === "off" ? "raw" : `${OCR_PIPELINE.mode}, PSM ${OCR_PIPELINE.psm}`}\`) is **${pct(partCRate, 1)}**, ${partCRate > PART_C_LIMIT ? `above the ${pct(PART_C_LIMIT, 0)} line: an intake state ("scan too poor to verify → rescan") is the next step, not lower points. Not implemented here.` : `under the ${pct(PART_C_LIMIT, 0)} line.`}`,
    "",
    "## A. False alarms on degraded OCR: harsh vs realistic",
    "",
    "The extraction is the fixture, correct by construction; only the OCR text is degraded. Every `not_found` is therefore a false alarm with respect to the extraction (it may still be a true signal that the scan is poor). Raw OCR = tesseract.js with no preprocessing and its default page segmentation, which is what the app ran before Task 7b.",
    "",
    "| Field | harsh: observations | harsh: false-alarm rate (≤ 95 % bound) | realistic: observations | realistic: false-alarm rate (≤ 95 % bound) |",
    "|---|---:|---:|---:|---:|",
    ...FIELDS.map((f) => `| \`${f}\` | ${harshRaw.fieldObs[f].n} | ${rate(harshRaw.fieldObs[f].fa, harshRaw.fieldObs[f].n)} (≤ ${pct(upperBound(harshRaw.fieldObs[f].fa, harshRaw.fieldObs[f].n), 1)}) | ${realRaw.fieldObs[f].n} | ${rate(realRaw.fieldObs[f].fa, realRaw.fieldObs[f].n)} (≤ ${pct(upperBound(realRaw.fieldObs[f].fa, realRaw.fieldObs[f].n), 1)}) |`),
    `| **Any critical field (per document)** | ${harshRaw.docs} docs | **${docFa(harshRaw)}** | ${realRaw.docs} docs | **${docFa(realRaw)}** |`,
    `| Control: undegraded 300 dpi (per document) | — | — | ${control.docs} docs | ${docFa(control)} |`,
    "",
    `Per-field rows count field observations (harsh ${harshRaw.obs}, realistic ${realRaw.obs}); fields within a document are not independent, so only the per-document rows support a population claim. Null fields are \`not_extracted\` and never counted.`,
    "",
    "Document false-alarm rate by blur (raw OCR):",
    "",
    "| Profile | Blur | Documents | With a false alarm | Rate |",
    "|---|---|---:|---:|---:|",
    ...(["harsh", "realistic"] as const).flatMap((p) => Object.entries(run(p, "off").byBlur).sort().map(([k, v]) => `| ${p} | ${k} | ${v.n} | ${v.fa} | ${rate(v.fa, v.n)} |`)),
    "",
    "## Part B. OCR clean-up before Tesseract: before / after",
    "",
    "Uploads only; seeded claims score on the fixture. Same documents, same seeds; only the OCR path differs. **End-to-end false alarm** = the correct extraction of a claim the engine otherwise auto-approves is moved to REVIEW/ESCALATE when grounded against this OCR text. **Detection on degraded text** = injected errors (absent + confusable) caught when grounded against this OCR text, counted only on documents where the correct extraction still passes, so a false alarm is never credited as a detection.",
    "",
    "| Profile | OCR path | Doc false-alarm rate (≤ 95 %) | invoiceNumber | invoiceDate | poNumber | total | vendorName | Mean words | Mean word conf. | End-to-end false alarm | Detection on degraded text | Prep fallbacks |",
    "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...runs.map(
      (r) =>
        `| ${r.profile} | ${variantLabel(r.ocr)} | ${docFa(r)} | ${(["invoiceNumber", "invoiceDate", "poNumber", "total", "vendorName"] as Field[]).map((f) => rate(r.fieldObs[f].fa, r.fieldObs[f].n)).join(" | ")} | ${r.meanWords.toFixed(0)} | ${r.meanWordConf.toFixed(3)} | ${fmtRate(r.e2eMoved, r.e2eDocs)} | ${fmtRate(r.detCaught, r.detN)} | ${r.prepFallbacks} |`,
    ),
    "",
    "### PSM 3 vs PSM 6 (realistic profile, one variant per claim, 130 documents)",
    "",
    "| OCR path | PSM | Doc false-alarm rate | Mean word conf. | Mean words |",
    "|---|---|---:|---:|---:|",
    ...psmTrials.map((t) => `| ${t.ocr.prep === "off" ? "raw" : t.ocr.prep === "gray" ? "grayscale clean-up" : "binarised clean-up"} | ${t.ocr.psm} | ${fmtRate(t.docsFa, t.docs)} | ${t.meanWordConf.toFixed(3)} | ${t.meanWords.toFixed(0)} |`),
    "",
    `Chosen per path (fewest documents with a false alarm, then higher mean word confidence): grayscale → PSM ${bestPsm("gray")}, binarised → PSM ${bestPsm("binary")}. Raw OCR in the main table keeps tesseract.js's default segmentation, which is what the app ran.`,
    "",
    `**What the app ships.** \`OCR_PIPELINE\` in \`src/lib/ai/ocr-prep.ts\` = \`${JSON.stringify(OCR_PIPELINE)}\`. The benchmark's recommendation from the realistic profile is \`${JSON.stringify(recommended.prep === "off" ? { mode: "off", psm: "default" } : { mode: recommended.prep, psm: recommended.psm })}\`${ocrVersion(recommended) === ocrVersion(OCR_PIPELINE.mode === "off" ? RAW : { prep: OCR_PIPELINE.mode, psm: OCR_PIPELINE.psm }) ? " (they agree)" : " (**they disagree — update the constant**)"}. A clean-up path is only recommended when it strictly lowers the realistic document false-alarm rate.`,
    "",
    "## B. Recall on injected extraction errors",
    "",
    `Base set: the ${base.size} seeded claims whose true extraction scores AUTO_APPROVE (an error can only "move the decision" on a claim that would otherwise pass). One error per document; the OCR text is the fixture's clean text. **End-to-end detection** = \`evaluateRisk\` on the mutated extraction (grounding attached) returns REVIEW or ESCALATE.`,
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
    `| Correct value, harsh degraded OCR (raw) | ${harshRaw.obsFa} | ${harshRaw.obs - harshRaw.obsFa} |`,
    `| Correct value, realistic degraded OCR (raw) | ${realRaw.obsFa} | ${realRaw.obs - realRaw.obsFa} |`,
    `| Correct value, undegraded OCR (control) | ${control.obsFa} | ${control.obs - control.obsFa} |`,
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
    "- The degraded corpora measure this renderer and these degradation ranges on these 130 synthetic layouts with Tesseract; real scans differ. `realistic` is a judgement call about a typical office scan, not a measurement of one; the false-alarm rate is a property of the OCR quality as much as of grounding.",
    "- The base claims are synthetic and share layouts; documents from the same claim (5 variants) are not independent of each other either, so treat the per-document bounds as optimistic.",
    "- The model extractor is not exercised (no DeepSeek calls): this benchmark measures grounding and the rule ensemble given an extraction, not the extractor's error rate.",
    "",
  );
  await writeFile(path.resolve("docs/GROUNDING_BENCH.md"), md.join("\n"));

  const cols = ["population", "profile", "ocr_pipeline", "doc_id", "claim_id", "field", "kind", "detail", "grounding", "flagged", "is_error", "true_decision", "mutated_decision", "detected_e2e", "new_rules", "exposure_cents", "ocr_confidence", "word_count", "mean_word_confidence"];
  const esc = (v: unknown) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  await writeFile(path.resolve("docs/grounding-bench.csv"), [cols.join(","), ...csvRows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n") + "\n");

  log("");
  log(md.slice(0, md.indexOf("## A. False alarms on degraded OCR: harsh vs realistic")).join("\n"));
  log(md.slice(md.indexOf("## Part B. OCR clean-up before Tesseract: before / after"), md.indexOf("## B. Recall on injected extraction errors")).join("\n"));
  log(`Wrote docs/GROUNDING_BENCH.md and docs/grounding-bench.csv (${csvRows.length} rows) in ${Math.round((Date.now() - started) / 1000)} s.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
