// Label/layout variant benchmark (Task 13 Part B, DECISIONS D-45) → docs/variants.csv + docs/EXTRACTION_VARIANTS.md.
// Does extraction still work when the invoice is not our template? The same seeded claim data is rendered with
// controlled label and layout variation, rasterised in headless Chromium, read by the REAL Tesseract through the
// app's own OCR pipeline (OCR_PIPELINE: grayscale clean-up, PSM 3), extracted by the LIVE model with the app's
// prompt, then grounded, presence-classified and scored by the real risk engine. No DB access.
//
//   label axis : canonical · abbreviated · verbose · German · Chinese   (layout held at label-left)
//   layout axis: label-left · label-above · dense two-column            (labels held at canonical)
//
// Needs AI_MODE=live, DEEPSEEK_API_KEY and ./eng.traineddata; without them it prints why and exits 0 (CI stays green).
// OCR text and model output are cached under .bench-cache/variants/ (keyed by HTML, and by OCR text + prompt
// version + model), so a re-run makes no model calls unless the inputs changed.
// Usage: pnpm bench:variants   (VARIANT_DOCS=n caps the documents per axis, default and maximum 20)
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const DOCS = Math.min(20, Math.max(1, Number(process.env.VARIANT_DOCS ?? 20)));
const CONCURRENCY = 4;
const CACHE = path.resolve(".bench-cache/variants");
const MODEL_PATH = path.resolve("eng.traineddata");
const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 24);

function skip(why: string): never {
  console.log(`bench:variants skipped — ${why}`);
  console.log("It needs AI_MODE=live, DEEPSEEK_API_KEY and ./eng.traineddata (see scripts/degrade.ts). Nothing was written.");
  process.exit(0);
}

async function main() {
  if (existsSync(".env")) process.loadEnvFile(".env"); // the shell environment wins over .env
  if ((process.env.AI_MODE ?? "mock") !== "live") skip(`AI_MODE is "${process.env.AI_MODE ?? "mock"}", not "live".`);
  if (!process.env.DEEPSEEK_API_KEY) skip("DEEPSEEK_API_KEY is not set.");
  if (!existsSync(MODEL_PATH)) skip(`Tesseract model not found at ${MODEL_PATH}.`);

  // Imported after the gate so a skipped run loads nothing that needs a key.
  const { buildSeedPlan, seedRiskInput } = await import("../src/lib/seed/run");
  const { evaluateRisk } = await import("../src/lib/risk/score");
  const { groundExtraction } = await import("../src/lib/ai/grounding");
  const { presenceOf } = await import("../src/lib/ai/presence");
  const { extractWithDeepSeek } = await import("../src/lib/ai/deepseek");
  const { aiConfig } = await import("../src/lib/ai/provider");
  const { OCR_PIPELINE, prepareForOcr } = await import("../src/lib/ai/ocr-prep");
  const { PROMPT_VERSION_EXTRACT } = await import("../src/lib/domain/constants");
  const { upperBound, lowerBound } = await import("../src/lib/bench/stats");
  const V = await import("../src/lib/bench/variants");

  const plan = buildSeedPlan();
  // The 20 documents: seeded claims that AUTO-CLEAR on their reference extraction, evenly spaced by claim ID, so
  // "error in cleared claims" measures what a variant does to claims that would otherwise pass untouched.
  const clean = plan.claims
    .filter((c) => evaluateRisk(seedRiskInput(plan, c)).decision === "AUTO_APPROVE")
    .sort((a, b) => (a.claimId < b.claimId ? -1 : 1));
  const picked = Array.from({ length: Math.min(DOCS, clean.length) }, (_, i) => clean[Math.floor((i * clean.length) / Math.min(DOCS, clean.length))]);
  const model = aiConfig().model;
  console.log(`bench:variants — ${picked.length} documents per axis, model ${model}, prompt ${PROMPT_VERSION_EXTRACT}, OCR ${OCR_PIPELINE.mode}/PSM ${OCR_PIPELINE.psm}`);

  type Job = { key: string; claimId: string; label: (typeof V.LABEL_VARIANTS)[number]; layout: (typeof V.LAYOUT_VARIANTS)[number] };
  const jobs = new Map<string, Job>();
  for (const c of picked) {
    for (const label of V.LABEL_VARIANTS) jobs.set(`${c.claimId}|${label}|label-left`, { key: `${c.claimId}|${label}|label-left`, claimId: c.claimId, label, layout: "label-left" });
    for (const layout of V.LAYOUT_VARIANTS) jobs.set(`${c.claimId}|canonical|${layout}`, { key: `${c.claimId}|canonical|${layout}`, claimId: c.claimId, label: "canonical", layout });
  }
  await mkdir(CACHE, { recursive: true });

  // ── 1. render + OCR (cached by HTML) ─────────────────────────────────────────────────────────────────────
  const ocr = new Map<string, { text: string; confidence: number }>();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 850, height: 1100 }, deviceScaleFactor: 3 }); // ≈ 300 dpi
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng", 1, { cachePath: path.dirname(MODEL_PATH), cacheMethod: "readOnly", langPath: path.dirname(MODEL_PATH), gzip: false });
  if (OCR_PIPELINE.psm !== "default") await worker.setParameters({ tessedit_pageseg_mode: OCR_PIPELINE.psm as never });
  try {
    let n = 0;
    for (const j of jobs.values()) {
      const doc = plan.claims.find((c) => c.claimId === j.claimId)!.doc;
      const html = V.variantHtml(doc, j.label, j.layout);
      const file = path.join(CACHE, `ocr-${sha(`${html}|${OCR_PIPELINE.mode}|${OCR_PIPELINE.psm}`)}.json`);
      if (existsSync(file)) {
        ocr.set(j.key, JSON.parse(await readFile(file, "utf8")));
      } else {
        await page.setContent(html, { waitUntil: "load" });
        const png = await page.screenshot({ fullPage: true, type: "png" });
        const { image } = OCR_PIPELINE.mode === "off" ? { image: png } : prepareForOcr(png, "image/png", { mode: OCR_PIPELINE.mode, psm: OCR_PIPELINE.psm });
        const { data } = await worker.recognize(image);
        const entry = { text: data.text, confidence: Math.max(0, Math.min(1, (data.confidence ?? 0) / 100)) };
        await writeFile(file, JSON.stringify(entry));
        ocr.set(j.key, entry);
      }
      if (++n % 20 === 0 || n === jobs.size) console.log(`  OCR ${n}/${jobs.size}`);
    }
  } finally {
    await worker.terminate();
    await browser.close();
  }

  // ── 2. live extraction (cached by OCR text + prompt version + model) ────────────────────────────────────
  type Extracted = { extraction: import("../src/lib/domain/schemas").Extraction | null; error: string | null; inputTokens: number; outputTokens: number; cached: boolean };
  const extracted = new Map<string, Extracted>();
  const queue = [...jobs.values()];
  let calls = 0;
  let inTok = 0;
  let outTok = 0;
  let done = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (let j = queue.shift(); j; j = queue.shift()) {
        const o = ocr.get(j.key)!;
        const category = plan.claims.find((c) => c.claimId === j.claimId)!.category;
        const file = path.join(CACHE, `x-${sha(`${o.text}|${category}|${PROMPT_VERSION_EXTRACT}|${model}`)}.json`);
        let r: Extracted;
        if (existsSync(file)) r = { ...JSON.parse(await readFile(file, "utf8")), cached: true };
        else {
          try {
            const live = await extractWithDeepSeek(o.text, { category }, `bench-variants-${sha(j.key)}`);
            r = { extraction: live.extraction, error: null, inputTokens: live.usage.inputTokens, outputTokens: live.usage.outputTokens, cached: false };
          } catch (err) {
            r = { extraction: null, error: err instanceof Error ? err.message : String(err), inputTokens: 0, outputTokens: 0, cached: false };
          }
          calls++;
          inTok += r.inputTokens;
          outTok += r.outputTokens;
          if (r.extraction) await writeFile(file, JSON.stringify(r));
        }
        extracted.set(j.key, r);
        if (++done % 20 === 0 || done === jobs.size) console.log(`  extract ${done}/${jobs.size} (${calls} model calls, ${inTok} in / ${outTok} out tokens)`);
      }
    }),
  );

  // ── 3. score ────────────────────────────────────────────────────────────────────────────────────────────
  type Row = import("../src/lib/bench/variants").DocResult & { rules: string; decision: string; ocrConfidence: number; error: string | null };
  const rows: Row[] = [];
  for (const j of jobs.values()) {
    const claim = plan.claims.find((c) => c.claimId === j.claimId)!;
    const truth = plan.fixtures.get(j.claimId)!.fixture.extraction;
    const o = ocr.get(j.key)!;
    const x = extracted.get(j.key)!;
    const axes: ("label" | "layout")[] = [];
    if (j.layout === "label-left") axes.push("label");
    if (j.label === "canonical") axes.push("layout");
    let outcomes: Row["outcomes"];
    let escalated = true; // a failed extraction is a human's: escalated, never cleared
    let cleared = false;
    let rules = "extraction-failed";
    let decision = "ERROR";
    if (x.extraction) {
      // As for an upload (D-37): geometry and confidence come from the OCR layer, never the model.
      const conf = Object.fromEntries(V.BENCH_FIELDS.map((f) => [f, o.confidence]));
      let e = { ...x.extraction, fieldConfidence: { ...x.extraction.fieldConfidence, ...conf }, boundingBoxes: [], vendor: { ...x.extraction.vendor, confidence: o.confidence } };
      e = { ...e, fieldChecks: groundExtraction(e, o.text) };
      e = { ...e, fieldPresence: presenceOf(e, o.text) };
      const result = evaluateRisk({ ...seedRiskInput(plan, claim), extraction: e });
      outcomes = Object.fromEntries(V.BENCH_FIELDS.map((f) => [f, V.fieldOutcome(f, e, truth)])) as Row["outcomes"];
      escalated = result.findings.some((f) => ["R-14", "R-19", "R-20"].includes(f.ruleId));
      cleared = result.decision === "AUTO_APPROVE";
      rules = result.findings.map((f) => f.ruleId).join(" ") || "—";
      decision = result.decision;
    } else outcomes = Object.fromEntries(V.BENCH_FIELDS.map((f) => [f, (f === "vendorName" ? truth.vendor.name : truth[f]) === null ? "correct-null" : "missed"])) as Row["outcomes"];
    for (const axis of axes) rows.push({ axis, variant: axis === "label" ? j.label : j.layout, claimId: j.claimId, outcomes, escalated, cleared, rules, decision, ocrConfidence: o.confidence, error: x.error });
  }

  // ── 4. write ────────────────────────────────────────────────────────────────────────────────────────────
  const csvCell = (v: unknown) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ["axis", "variant", "claim_id", ...V.BENCH_FIELDS, "escalated_r14_r19_r20", "auto_cleared", "doc_has_error", "decision", "rules", "ocr_confidence", "error"];
  const csv = [header.join(","), ...rows.map((r) => [r.axis, r.variant, r.claimId, ...V.BENCH_FIELDS.map((f) => r.outcomes[f]), r.escalated, r.cleared, V.docHasError(r), r.decision, r.rules, r.ocrConfidence.toFixed(3), r.error].map(csvCell).join(","))];
  await writeFile(path.resolve("docs/variants.csv"), `${csv.join("\n")}\n`);

  const p = (x: number) => `${(x * 100).toFixed(1)} %`;
  const bound = (k: number, n: number) => (n ? `${p(lowerBound(k, n))}–${p(upperBound(k, n))}` : "—");
  const table = (axis: "label" | "layout", variants: string[]) => {
    const lines = [
      "| Variant | Docs | Field accuracy (returned values) | Escalation rate (R-14 / R-19 / R-20) | Error in auto-cleared claims | Values returned |",
      "|---|---:|---|---|---|---:|",
    ];
    for (const v of variants) {
      const s = V.summarise(rows, axis, v);
      lines.push(
        `| ${v} | ${s.docs} | **${p(s.accuracy)}** (${s.correct}/${s.returned}; 95 % ${bound(s.correct, s.returned)}) | **${p(s.escalationRate)}** (${s.escalated}/${s.docs}) | **${s.cleared ? p(s.errorInCleared) : "—"}** (${s.clearedWithError}/${s.cleared}; ≤ ${s.cleared ? p(upperBound(s.clearedWithError, s.cleared)) : "—"}) | ${s.returned}/${s.docs * V.BENCH_FIELDS.length} |`,
      );
    }
    return lines.join("\n");
  };
  const fieldTable = (axis: "label" | "layout", variants: string[]) => {
    const lines = [`| Variant | ${V.BENCH_FIELDS.join(" | ")} |`, `|---|${V.BENCH_FIELDS.map(() => "---").join("|")}|`];
    for (const v of variants) {
      const rs = rows.filter((r) => r.axis === axis && r.variant === v);
      const cell = (f: (typeof V.BENCH_FIELDS)[number]) => {
        const c = (k: string) => rs.filter((r) => r.outcomes[f] === k).length;
        return `${c("correct") + c("correct-null")} ok · ${c("wrong")} wrong · ${c("missed")} missed`;
      };
      lines.push(`| ${v} | ${V.BENCH_FIELDS.map(cell).join(" | ")} |`);
    }
    return lines.join("\n");
  };
  const json = {
    generatedFor: { docsPerAxis: picked.length, claims: picked.map((c) => c.claimId), model, prompt: PROMPT_VERSION_EXTRACT, ocr: OCR_PIPELINE },
    label: V.LABEL_VARIANTS.map((v) => V.summarise(rows, "label", v)),
    layout: V.LAYOUT_VARIANTS.map((v) => V.summarise(rows, "layout", v)),
    modelCallsThisRun: calls,
    tokensThisRun: { input: inTok, output: outTok },
  };
  await writeFile(path.join(CACHE, "summary.json"), JSON.stringify(json, null, 2));
  // The generated tables go between markers in docs/EXTRACTION_VARIANTS.md; the written analysis around them is kept.
  const tables = [
    "<!-- tables:start (generated by pnpm bench:variants; do not edit by hand) -->",
    "",
    `Documents per axis: **${picked.length}** seeded claims that auto-clear on their reference extraction (${picked.map((c) => c.claimId).join(", ")}). Model \`${model}\`, prompt \`${PROMPT_VERSION_EXTRACT}\`, OCR: Tesseract \`eng\`, ${OCR_PIPELINE.mode} clean-up, PSM ${OCR_PIPELINE.psm}, clean ~300 dpi renders.`,
    "",
    "### Label axis (layout held at label-left)",
    "",
    table("label", V.LABEL_VARIANTS),
    "",
    "Per field (ok includes a correct null, e.g. no PO on a travel invoice):",
    "",
    fieldTable("label", V.LABEL_VARIANTS),
    "",
    "### Layout axis (labels held at canonical)",
    "",
    table("layout", V.LAYOUT_VARIANTS),
    "",
    "Per field:",
    "",
    fieldTable("layout", V.LAYOUT_VARIANTS),
    "",
    "<!-- tables:end -->",
  ].join("\n");
  const docPath = path.resolve("docs/EXTRACTION_VARIANTS.md");
  const END = "<!-- tables:end -->";
  const existing = existsSync(docPath) ? await readFile(docPath, "utf8") : `# Extraction variants\n\n<!-- tables:start -->${END}\n`;
  const at = existing.indexOf("<!-- tables:start");
  const end = existing.indexOf(END);
  await writeFile(docPath, at >= 0 && end > at ? `${existing.slice(0, at)}${tables}${existing.slice(end + END.length)}` : `${existing.trimEnd()}\n\n${tables}\n`);
  console.log(`\nWrote docs/variants.csv (${rows.length} rows) and the tables in docs/EXTRACTION_VARIANTS.md.`);
  console.log(`Model calls this run: ${calls} (${inTok} input / ${outTok} output tokens); the rest came from the cache.`);
  console.log(JSON.stringify({ label: json.label, layout: json.layout }, null, 1));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
