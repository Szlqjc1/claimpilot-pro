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
  const { OCR_PIPELINE, OCR_PREP_VERSION, prepareForOcr } = await import("../src/lib/ai/ocr-prep");
  const { PROMPT_VERSION_EXTRACT } = await import("../src/lib/domain/constants");
  const { upperBound, lowerBound } = await import("../src/lib/bench/stats");
  const V = await import("../src/lib/bench/variants");
  const C = await import("../src/lib/bench/capture");
  const { CORNER_DETECTOR_VERSION } = await import("../src/lib/ai/corners");

  const plan = buildSeedPlan();
  // The 20 documents: seeded claims that AUTO-CLEAR on their reference extraction, evenly spaced by claim ID, so
  // "error in cleared claims" measures what a variant does to claims that would otherwise pass untouched.
  const clean = plan.claims
    .filter((c) => evaluateRisk(seedRiskInput(plan, c)).decision === "AUTO_APPROVE")
    .sort((a, b) => (a.claimId < b.claimId ? -1 : 1));
  const picked = Array.from({ length: Math.min(DOCS, clean.length) }, (_, i) => clean[Math.floor((i * clean.length) / Math.min(DOCS, clean.length))]);
  const model = aiConfig().model;
  console.log(`bench:variants — ${picked.length} documents per axis, model ${model}, prompt ${PROMPT_VERSION_EXTRACT}, OCR ${OCR_PIPELINE.mode}/PSM ${OCR_PIPELINE.psm}`);

  type Job = { key: string; claimId: string; label: (typeof V.LABEL_VARIANTS)[number]; layout: (typeof V.LAYOUT_VARIANTS)[number]; capture: import("../src/lib/bench/capture").CaptureId; font: import("../src/lib/bench/variants").FontVariant };
  const jobs = new Map<string, Job>();
  for (const c of picked) {
    for (const label of V.LABEL_VARIANTS) jobs.set(`${c.claimId}|${label}|label-left`, { key: `${c.claimId}|${label}|label-left`, claimId: c.claimId, label, layout: "label-left", capture: "none", font: "default" });
    for (const layout of V.LAYOUT_VARIANTS) jobs.set(`${c.claimId}|canonical|${layout}`, { key: `${c.claimId}|canonical|${layout}`, claimId: c.claimId, label: "canonical", layout, capture: "none", font: "default" });
    // Perspective arms (Task 14 A): the canonical render, photographed (A1), photographed and oracle-rectified (A2), or
    // photographed, corner-detected and rectified (A3, D-49).
    for (const arm of C.PERSPECTIVE_ARMS.filter((a) => a.id !== "none")) {
      const key = `${c.claimId}|canonical|label-left|${arm.id}`;
      jobs.set(key, { key, claimId: c.claimId, label: "canonical", layout: "label-left", capture: arm.id, font: "default" });
    }
    // Typography (Task 14 B1): the canonical render in another face or at small print.
    for (const font of V.FONT_VARIANTS.filter((f) => f !== "default")) {
      const key = `${c.claimId}|canonical|label-left|font-${font}`;
      jobs.set(key, { key, claimId: c.claimId, label: "canonical", layout: "label-left", capture: "none", font });
    }
    // Capture quality (Task 14 B2): shadow, clutter, low contrast on the canonical render.
    for (const arm of C.QUALITY_ARMS.filter((a) => a.id !== "none")) {
      const key = `${c.claimId}|canonical|label-left|${arm.id}`;
      jobs.set(key, { key, claimId: c.claimId, label: "canonical", layout: "label-left", capture: arm.id, font: "default" });
    }
  }
  await mkdir(CACHE, { recursive: true });

  // ── 1. render + OCR (cached by HTML) ─────────────────────────────────────────────────────────────────────
  type OcrEntry = { text: string; confidence: number; detection?: import("../src/lib/bench/capture").DetectionReport };
  const ocr = new Map<string, OcrEntry>();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 850, height: 1100 }, deviceScaleFactor: 3 }); // ≈ 300 dpi
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng", 1, { cachePath: path.dirname(MODEL_PATH), cacheMethod: "readOnly", langPath: path.dirname(MODEL_PATH), gzip: false });
  if (OCR_PIPELINE.psm !== "default") await worker.setParameters({ tessedit_pageseg_mode: OCR_PIPELINE.psm as never });
  try {
    let n = 0;
    // The last render, kept so the perspective arms of one document do not re-render it.
    let last = null as { html: string; png: Buffer } | null;
    for (const j of jobs.values()) {
      const doc = plan.claims.find((c) => c.claimId === j.claimId)!.doc;
      const html = V.variantHtml(doc, j.label, j.layout, j.font);
      // A clean render keeps its Task 13 cache key, so the baseline is reused, never re-read.
      // Detected arms also key on the detector version, so a detector change re-reads them (and only them).
      const capKey = j.capture === "none" ? "" : `|${j.capture}|${C.CAPTURE_VERSION}${j.capture.startsWith("detected-") ? `|${CORNER_DETECTOR_VERSION}` : ""}`;
      const file = path.join(CACHE, `ocr-${sha(`${html}${capKey}|${OCR_PIPELINE.mode}|${OCR_PIPELINE.psm}${(OCR_PREP_VERSION as string) === "prep-v1" ? "" : `|${OCR_PREP_VERSION}`}`)}.json`); // prep-v1 keys predate the version in the key
      if (existsSync(file)) {
        ocr.set(j.key, JSON.parse(await readFile(file, "utf8")));
      } else {
        if (last?.html !== html) {
          await page.setContent(html, { waitUntil: "load" });
          last = { html, png: await page.screenshot({ fullPage: true, type: "png" }) };
        }
        const input = j.capture === "none" ? { buf: last.png, mime: "image/png" as const } : C.captureBytes(j.capture, C.decodePng(last.png), j.claimId);
        const { image } = OCR_PIPELINE.mode === "off" ? { image: input.buf } : prepareForOcr(input.buf, input.mime, { mode: OCR_PIPELINE.mode, psm: OCR_PIPELINE.psm });
        const { data } = await worker.recognize(image);
        const entry: OcrEntry = { text: data.text, confidence: Math.max(0, Math.min(1, (data.confidence ?? 0) / 100)), ...("detection" in input && input.detection ? { detection: input.detection } : {}) };
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
    const axes: { axis: string; variant: string }[] = [];
    const FONT_LABEL: Record<string, string> = { default: "sans (baseline)", serif: "serif (Times New Roman)", condensed: "condensed (Arial Narrow)", "small-print": "small print (8 pt body)" };
    if (j.font !== "default") axes.push({ axis: "font", variant: FONT_LABEL[j.font] });
    else if (j.capture === "none") {
      if (j.layout === "label-left") axes.push({ axis: "label", variant: j.label });
      if (j.label === "canonical") axes.push({ axis: "layout", variant: j.layout });
      if (j.label === "canonical" && j.layout === "label-left") {
        axes.push({ axis: "perspective", variant: C.PERSPECTIVE_ARMS[0].label });
        axes.push({ axis: "font", variant: FONT_LABEL.default });
        axes.push({ axis: "quality", variant: C.QUALITY_ARMS[0].label });
      }
    } else if (C.QUALITY_ARMS.some((a) => a.id === j.capture)) axes.push({ axis: "quality", variant: C.QUALITY_ARMS.find((a) => a.id === j.capture)!.label });
    else axes.push({ axis: "perspective", variant: C.PERSPECTIVE_ARMS.find((a) => a.id === j.capture)!.label });
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
    for (const { axis, variant } of axes) rows.push({ axis, variant, claimId: j.claimId, outcomes, escalated, cleared, rules, decision, ocrConfidence: o.confidence, error: x.error });
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
  const table = (axis: string, variants: string[]) => {
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
  const fieldTable = (axis: string, variants: string[]) => {
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

  // ── 5. perspective (Task 14 A): results + the pre-registered decision, into docs/PERSPECTIVE.md ─────────────
  const persp = C.PERSPECTIVE_ARMS.map((a) => V.summarise(rows, "perspective", a.label));
  // Part B rows (font, quality), added to the same table when their documents exist; baselines excluded (= A0).
  const fontLabels = [...new Set(rows.filter((r) => r.axis === "font").map((r) => r.variant))].sort((a, b) => (a.startsWith("sans") ? -1 : b.startsWith("sans") ? 1 : 0));
  const extra = [
    ...fontLabels.filter((v) => !v.startsWith("sans")).map((v) => V.summarise(rows, "font", v)),
    ...C.QUALITY_ARMS.slice(1).map((a) => V.summarise(rows, "quality", a.label)),
  ].filter((s) => s.docs > 0);
  if (persp.every((s) => s.docs > 0)) {
    const by = (label: string) => persp.find((s) => s.variant === label)!;
    const a0 = by("A0 baseline");
    const pairs = [
      { a1: by("A1 pitch 20 / yaw 15"), a2: by("A2 oracle-rectified (20/15)"), decides: true },
      { a1: by("A1 pitch 10 / yaw 10"), a2: by("A2 oracle-rectified (10/10)"), decides: false },
    ].map((pr) => ({ ...pr, d: V.recoveryDecision({ a0: a0.bad, a1: pr.a1.bad, a2: pr.a2.bad }, a0.docs) }));
    // A3 (D-49): the same recovery arithmetic with detected corners in place of the true ones; reported, not a decision.
    const detected = [
      { angle: "20/15", id: "detected-20-15", a1: by("A1 pitch 20 / yaw 15"), a2: by("A2 oracle-rectified (20/15)"), a3: by("A3 detected-rectified (20/15)") },
      { angle: "10/10", id: "detected-10-10", a1: by("A1 pitch 10 / yaw 10"), a2: by("A2 oracle-rectified (10/10)"), a3: by("A3 detected-rectified (10/10)") },
    ].map((x) => {
      const reports = picked.map((c) => ocr.get(`${c.claimId}|canonical|label-left|${x.id}`)?.detection).filter((r) => r !== undefined);
      const errs = reports.flatMap((r) => (r.errorPx ? [r.errorPx] : []));
      return {
        ...x,
        d: V.recoveryDecision({ a0: a0.bad, a1: x.a1.bad, a2: x.a3.bad }, a0.docs),
        found: reports.filter((r) => r.found).length,
        reported: reports.length,
        meanErr: errs.length ? errs.reduce((s, e) => s + e.mean, 0) / errs.length : null,
        maxErr: errs.length ? Math.max(...errs.map((e) => e.max)) : null,
      };
    });
    const recCell = (s: (typeof persp)[number]) => {
      const pr = pairs.find((x) => x.a2 === s) ?? detected.find((x) => x.a3 === s);
      if (!pr) return "—";
      return pr.d.recoveryPct === null ? `n/a (gap ${pr.d.gap})` : `**${p(pr.d.recoveryPct)}** (${pr.d.recovered} of ${pr.d.gap})`;
    };
    const px = (v: number | null) => (v === null ? "—" : `${v.toFixed(2)} px`);
    const VERDICT: Record<string, string> = {
      build: "≥ 70 % → **build corner detection**: geometry is the bottleneck.",
      "do-not-build": "≤ 30 % → **do not build corner detection**: the OCR, not the geometry, is the bottleneck.",
      spike: "between 30 % and 70 % → **recommend a spike, not a build**.",
      "no-measurable-gap": "gap ≤ 1 document → perspective costs nothing measurable at these angles; **do not build**.",
    };
    const decider = pairs[0];
    const block = [
      "<!-- results:start (generated by pnpm bench:variants; do not edit by hand) -->",
      "",
      `Documents: **${a0.docs}** (${picked.map((c) => c.claimId).join(", ")}). Model \`${model}\`, prompt \`${PROMPT_VERSION_EXTRACT}\`, capture \`${C.CAPTURE_VERSION}\`.`,
      "",
      "| Arm | Field accuracy (returned values) | Escalation (R-14 / R-19 / R-20) | Error in auto-cleared | bad (not a correct auto-clear) | Recovery % |",
      "|---|---|---|---|---|---|",
      ...[...persp, ...extra].map(
        (s) =>
          `| ${s.axis === "perspective" ? "" : `${s.axis === "font" ? "Font" : "Quality"}: `}${s.variant} | **${p(s.accuracy)}** (${s.correct}/${s.returned}) | **${p(s.escalationRate)}** (${s.escalated}/${s.docs}) | **${s.cleared ? p(s.errorInCleared) : "—"}** (${s.clearedWithError}/${s.cleared}) | ${s.bad}/${s.docs} | ${s.axis === "perspective" ? recCell(s) : "—"} |`,
      ),
      "",
      "The font and quality rows hold everything else at the canonical render; their baselines are the A0 documents.",
      "",
      "Per field, perspective:",
      "",
      fieldTable("perspective", C.PERSPECTIVE_ARMS.map((a) => a.label)),
      ...(extra.length
        ? ["", "Per field, font:", "", fieldTable("font", fontLabels), "", "Per field, capture quality:", "", fieldTable("quality", C.QUALITY_ARMS.map((a) => a.label))]
        : []),
      "",
      `**Decision (pre-registered rule, deciding pair 20/15):** gap = ${decider.d.gap}, recovered = ${decider.d.recovered}, recovery% = ${decider.d.recoveryPct === null ? "undefined" : p(decider.d.recoveryPct)}: ${VERDICT[decider.d.verdict]}`,
      `For reference, the 10/10 pair: gap = ${pairs[1].d.gap}, recovered = ${pairs[1].d.recovered}, recovery% = ${pairs[1].d.recoveryPct === null ? "undefined" : p(pairs[1].d.recoveryPct)} (${pairs[1].d.verdict}).`,
      "",
      `**Detected corners (A3, D-49, detector \`${CORNER_DETECTOR_VERSION}\`):**`,
      "",
      "| Angle | Page found | Corner error, mean / worst (px, photo ≈ 2550 px wide) | bad A1 → A3 (oracle A2) | Recovery % (A3) |",
      "|---|---|---|---|---|",
      ...detected.map(
        (x) =>
          `| ${x.angle} | ${x.found}/${x.reported} | ${px(x.meanErr)} / ${px(x.maxErr)} | ${x.a1.bad}/${x.a1.docs} → **${x.a3.bad}/${x.a3.docs}** (${x.a2.bad}/${x.a2.docs}) | ${x.d.recoveryPct === null ? "undefined" : p(x.d.recoveryPct)} (${x.d.recovered} of ${x.d.gap}) |`,
      ),
      "",
      "<!-- results:end -->",
    ].join("\n");
    const pPath = path.resolve("docs/PERSPECTIVE.md");
    if (existsSync(pPath)) {
      const doc = await readFile(pPath, "utf8");
      const s0 = doc.indexOf("<!-- results:start");
      const e0 = doc.indexOf("<!-- results:end -->");
      if (s0 >= 0 && e0 > s0) await writeFile(pPath, `${doc.slice(0, s0)}${block}${doc.slice(e0 + "<!-- results:end -->".length)}`);
    }
    console.log(`Detection: ${detected.map((x) => `${x.angle} found ${x.found}/${x.reported}, mean ${px(x.meanErr)}, worst ${px(x.maxErr)}`).join(" · ")}`);
    console.log(`Perspective: ${persp.map((s) => `${s.variant}: bad ${s.bad}/${s.docs}`).join(" · ")} → ${decider.d.verdict}`);
  }
  console.log(`Model calls this run: ${calls} (${inTok} input / ${outTok} output tokens); the rest came from the cache.`);
  console.log(JSON.stringify({ label: json.label, layout: json.layout }, null, 1));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
