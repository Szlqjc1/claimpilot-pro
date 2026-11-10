// Text-size sweep at a fixed scan resolution (Task 15, DECISIONS D-53) → docs/RESOLUTION.md + docs/resolution.csv.
// Model-free. One A4 page at 200 dpi (1654 × 2339 px), same layout, data and image size; only the text size changes:
// 6, 8, 10, 12, 14 pt body text (every element scaled from it, see sizeCss). The variable that matters is the
// x-height in PIXELS, so it is measured on a rendered sample line rather than derived from the point size.
// Per size, on the same 20 documents: character error rate against the renderer's transcript, critical values found
// by the grounding matchers, whether the real rules (R-14 / R-19) notice what could not be verified with the
// known-good extraction substituted for the model's, and mean OCR page confidence next to the CER (calibration).
// `--live <pt>` adds the one live confirmation at that size (at most 20 calls; needs AI_MODE=live and a key).
// Usage: pnpm bench:resolution [--live 8]   (needs ./eng.traineddata; exits 0 with a message otherwise)
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { openHarness, pickBenchClaims, skipWithoutModel } from "./lib/ocr-harness";

export const DPI = 200;
const CSS_PX_PER_IN = 100; // the renderer's CSS pixel is 1/100 in, so device px = CSS px × DPI / 100
const SCALE = DPI / CSS_PX_PER_IN;
const PAGE = { cssWidth: 827, cssHeight: 1170 }; // A4 (8.27 × 11.69 in) → 1654 × 2340 px at 200 dpi
/** The specified sweep (6–14 pt) found no break, so it is extended downward (3–5 pt) to locate one (D-53). */
const SPEC_SIZES_PT = [6, 8, 10, 12, 14];
const SIZES_PT = [3, 4, 5, ...SPEC_SIZES_PT];
const liveArg = process.argv.indexOf("--live");
const LIVE_PT = liveArg >= 0 ? Number(process.argv[liveArg + 1]) : null;

async function main() {
  skipWithoutModel("bench:resolution");
  if (existsSync(".env")) process.loadEnvFile(".env");
  const V = await import("../src/lib/bench/variants");
  const M = await import("../src/lib/bench/ocr-metrics");
  const { plan, picked, inputFor } = await pickBenchClaims();
  const h = await openHarness();
  const bodyPx = (pt: number) => (pt * CSS_PX_PER_IN) / 72;

  type Row = { pt: number; claimId: string; cer: number; hits: number; known: number; r14: boolean; r19: boolean; decision: string; rules: string; confidence: number; text: string };
  const rows: Row[] = [];
  const xHeight: Record<number, number> = {};
  try {
    for (const pt of SIZES_PT) {
      // x-height: the ink height of a row of "x" in the body face at this size, at the scan resolution.
      xHeight[pt] = await h.inkHeight(`<div style="margin:40px;font:${bodyPx(pt)}px 'Segoe UI','Microsoft YaHei',Arial,sans-serif;color:#111">xxxxxxxxxx</div>`, SCALE);
      for (const c of picked) {
        const html = V.variantHtml(c.doc, "canonical", "label-left", "default", V.sizeCss(bodyPx(pt), PAGE.cssWidth));
        const png = await h.render(html, PAGE.cssWidth, SCALE, PAGE.cssHeight);
        const o = await h.ocr(png, "image/png");
        const input = inputFor(c);
        const risk = M.knownGoodRisk(input, o.text, o.confidence);
        rows.push({ pt, claimId: c.claimId, cer: M.cer(o.text, V.variantTranscript(c.doc, "canonical")), ...M.criticalHits(input, o.text), r14: risk.r14, r19: risk.r19, decision: risk.decision, rules: risk.rules.join(" ") || "—", confidence: o.confidence, text: o.text });
      }
      console.log(`  ${pt} pt: x-height ${xHeight[pt]} px (${h.freshOcrRuns()} fresh OCR runs so far)`);
    }
  } finally {
    await h.close();
  }

  const p = (x: number) => `${(x * 100).toFixed(1)} %`;
  const stats = (pt: number) => {
    const rs = rows.filter((r) => r.pt === pt);
    const n = rs.length;
    return {
      n,
      cer: rs.reduce((s, r) => s + r.cer, 0) / n,
      hits: rs.reduce((s, r) => s + r.hits, 0),
      known: rs.reduce((s, r) => s + r.known, 0),
      r14: rs.filter((r) => r.r14).length,
      r19: rs.filter((r) => r.r19).length,
      cleared: rs.filter((r) => r.decision === "AUTO_APPROVE").length,
      conf: rs.reduce((s, r) => s + r.confidence, 0) / n,
      emptyHighConf: rs.filter((r) => r.cer > 0.5 && r.confidence >= 0.85).length,
    };
  };

  // ── optional live confirmation at one size ────────────────────────────────────────────────────────────────
  let live = "";
  if (LIVE_PT !== null) {
    if (process.env.AI_MODE !== "live" || !process.env.DEEPSEEK_API_KEY) console.log("--live skipped: needs AI_MODE=live and DEEPSEEK_API_KEY.");
    else if (!SIZES_PT.includes(LIVE_PT)) console.log(`--live ${LIVE_PT}: not one of ${SIZES_PT.join(", ")} pt.`);
    else {
      const { extractWithDeepSeek } = await import("../src/lib/ai/deepseek");
      const { groundExtraction } = await import("../src/lib/ai/grounding");
      const { presenceOf } = await import("../src/lib/ai/presence");
      const { evaluateRisk } = await import("../src/lib/risk/score");
      const { PROMPT_VERSION_EXTRACT } = await import("../src/lib/domain/constants");
      const cache = path.resolve(".bench-cache/ocr-harness");
      await mkdir(cache, { recursive: true });
      let calls = 0;
      let inTok = 0;
      let outTok = 0;
      const tally = { review: 0, cleared: 0, clearedWrong: 0, nulls: 0, invented: 0, r14: 0, r19: 0, r20: 0 };
      for (const c of picked) {
        const r = rows.find((x) => x.pt === LIVE_PT && x.claimId === c.claimId)!;
        const file = path.join(cache, `x-${createHash("sha256").update(`${r.text}|${c.category}|${PROMPT_VERSION_EXTRACT}`).digest("hex").slice(0, 32)}.json`);
        let x: import("../src/lib/domain/schemas").Extraction;
        if (existsSync(file)) x = JSON.parse(await readFile(file, "utf8"));
        else {
          const out = await extractWithDeepSeek(r.text, { category: c.category }, `bench-res-${LIVE_PT}-${c.claimId}`);
          calls++;
          inTok += out.usage.inputTokens;
          outTok += out.usage.outputTokens;
          x = out.extraction;
          await writeFile(file, JSON.stringify(x));
        }
        const conf = Object.fromEntries(V.BENCH_FIELDS.map((f) => [f, r.confidence]));
        let e = { ...x, fieldConfidence: { ...x.fieldConfidence, ...conf }, boundingBoxes: [] };
        e = { ...e, fieldChecks: groundExtraction(e, r.text) };
        e = { ...e, fieldPresence: presenceOf(e, r.text) };
        const result = evaluateRisk({ ...inputFor(c), extraction: e });
        const truth = plan.fixtures.get(c.claimId)!.fixture.extraction;
        const outcomes = V.BENCH_FIELDS.map((f) => V.fieldOutcome(f, e, truth));
        const has = (id: string) => result.findings.some((f) => f.ruleId === id);
        if (result.decision === "AUTO_APPROVE") {
          tally.cleared++;
          if (outcomes.some((o) => o === "wrong" || o === "missed")) tally.clearedWrong++;
        } else tally.review++;
        tally.nulls += outcomes.filter((o) => o === "missed").length;
        tally.invented += outcomes.filter((o) => o === "wrong").length;
        if (has("R-14")) tally.r14++;
        if (has("R-19")) tally.r19++;
        if (has("R-20")) tally.r20++;
      }
      live = [
        `| Live, ${LIVE_PT} pt | Review / escalate | Auto-approved | …with a wrong field | Fields returned null | Fields returned wrong | R-14 | R-19 | R-20 |`,
        "|---|---|---|---|---|---|---|---|---|",
        `| ${picked.length} documents | ${tally.review} | ${tally.cleared} | ${tally.clearedWrong} | ${tally.nulls} | ${tally.invented} | ${tally.r14} | ${tally.r19} | ${tally.r20} |`,
        "",
        `Model calls this run: ${calls} (${inTok} input / ${outTok} output tokens); the rest came from the cache.`,
      ].join("\n");
      console.log(live);
    }
  }

  // ── write ───────────────────────────────────────────────────────────────────────────────────────────────────
  const csvCell = (v: unknown) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ["pt", "x_height_px", "claim_id", "cer", "critical_found", "critical_known", "r14", "r19", "decision", "rules", "ocr_confidence"];
  await writeFile(
    path.resolve("docs/resolution.csv"),
    `${[header.join(","), ...rows.map((r) => [r.pt, xHeight[r.pt], r.claimId, r.cer.toFixed(4), r.hits, r.known, r.r14, r.r19, r.decision, r.rules, r.confidence.toFixed(3)].map(csvCell).join(","))].join("\n")}\n`,
  );
  const table = [
    "| pt | x-height px | CER | Critical hit rate | R-14 fires | R-19 fires | Auto-clears (known-good) | Mean confidence |",
    "|---|---|---|---|---|---|---|---|",
    ...SIZES_PT.map((pt) => {
      const s = stats(pt);
      return `| ${pt}${SPEC_SIZES_PT.includes(pt) ? "" : " (ext.)"} | ${xHeight[pt]} | ${p(s.cer)} | ${s.hits}/${s.known} (${p(s.hits / s.known)}) | ${s.r14}/${s.n} | ${s.r19}/${s.n} | ${s.cleared}/${s.n} | ${s.conf.toFixed(3)} |`;
    }),
  ].join("\n");
  const END = "<!-- results:end -->";
  const block = [
    "<!-- results:start (generated by pnpm bench:resolution; do not edit by hand) -->",
    "",
    `Documents: **${picked.length}** per size (${picked.map((c) => c.claimId).join(", ")}). A4 at ${DPI} dpi (1654 × 2340 px), Tesseract \`eng\`, the app's OCR preparation (grayscale clean-up with illumination normalisation, PSM 3). Raw rows: [\`docs/resolution.csv\`](resolution.csv).`,
    "",
    table,
    ...(live ? ["", "Live confirmation (one run, at most 20 calls):", "", live] : []),
    "",
    END,
  ].join("\n");
  const docPath = path.resolve("docs/RESOLUTION.md");
  const existing = existsSync(docPath) ? await readFile(docPath, "utf8") : `# Text size and scan resolution\n\n<!-- results:start -->${END}\n`;
  const s0 = existing.indexOf("<!-- results:start");
  const e0 = existing.indexOf(END);
  const old = s0 >= 0 && e0 > s0 ? existing.slice(s0, e0) : "";
  const keepLive = !live && old.includes("Live confirmation") ? old.slice(old.indexOf("Live confirmation")).trimEnd() : "";
  const finalBlock = keepLive ? block.replace(`\n\n${END}`, `\n\n${keepLive}\n\n${END}`) : block;
  await writeFile(docPath, s0 >= 0 && e0 > s0 ? `${existing.slice(0, s0)}${finalBlock}${existing.slice(e0 + END.length)}` : `${existing.trimEnd()}\n\n${finalBlock}\n`);
  console.log(table);
  for (const pt of SIZES_PT) {
    const s = stats(pt);
    if (s.emptyHighConf) console.log(`  calibration: at ${pt} pt, ${s.emptyHighConf} page(s) with CER > 50 % reported confidence ≥ 0.85`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
