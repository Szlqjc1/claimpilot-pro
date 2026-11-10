// Illumination normalisation A/B (DECISIONS D-52) → docs/ILLUMINATION.md. Model-free by default.
// The same 20 documents and capture arms as docs/PERSPECTIVE.md, OCR'd with the app's preparation WITHOUT and WITH
// illumination normalisation, scored by the model-free metrics in src/lib/bench/ocr-metrics.ts: character error rate
// against the renderer's transcript, critical values found, and whether the real rules (R-14 / R-19) notice what could
// not be verified when the known-good extraction is substituted for the model's.
// `--live` adds ONE live confirmation on the shadow arm (at most 20 model calls; needs AI_MODE=live and a key).
// Usage: pnpm bench:illumination [--live]   (needs ./eng.traineddata; exits 0 with a message otherwise)
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { openHarness, pickBenchClaims, skipWithoutModel } from "./lib/ocr-harness";

const LIVE = process.argv.includes("--live");

async function main() {
  skipWithoutModel("bench:illumination");
  if (existsSync(".env")) process.loadEnvFile(".env");
  const V = await import("../src/lib/bench/variants");
  const C = await import("../src/lib/bench/capture");
  const M = await import("../src/lib/bench/ocr-metrics");
  const { plan, picked, inputFor } = await pickBenchClaims();
  const ARMS = [
    { id: "none", label: "clean scan" },
    { id: "shadow", label: "shadow (one third)" },
    { id: "low-contrast", label: "low contrast 60 % + JPEG q25" },
    { id: "clutter", label: "clutter (desk + 2 objects)" },
    { id: "photo-10-10", label: "photo pitch 10 / yaw 10" },
    { id: "photo-20-15", label: "photo pitch 20 / yaw 15" },
  ] as const;
  const h = await openHarness();
  type Row = { arm: string; illum: boolean; claimId: string; cer: number; hits: number; known: number; r14: boolean; r19: boolean; cleared: boolean; confidence: number; text: string };
  const rows: Row[] = [];
  try {
    for (const c of picked) {
      const html = V.variantHtml(c.doc, "canonical", "label-left");
      const ref = V.variantTranscript(c.doc, "canonical");
      const png = await h.render(html, 850, 3);
      const render = C.decodePng(png);
      for (const arm of ARMS) {
        const { buf, mime } = arm.id === "none" ? { buf: png, mime: "image/png" as const } : C.captureBytes(arm.id, render, c.claimId);
        for (const illum of [false, true]) {
          const o = await h.ocr(buf, mime, { illumination: illum });
          const hit = M.criticalHits(inputFor(c), o.text);
          const risk = M.knownGoodRisk(inputFor(c), o.text, o.confidence);
          rows.push({ arm: arm.label, illum, claimId: c.claimId, cer: M.cer(o.text, ref), ...hit, r14: risk.r14, r19: risk.r19, cleared: risk.decision === "AUTO_APPROVE", confidence: o.confidence, text: o.text });
        }
      }
      console.log(`  ${c.claimId} done (${h.freshOcrRuns()} fresh OCR runs so far)`);
    }
  } finally {
    await h.close();
  }

  const p = (x: number) => `${(x * 100).toFixed(1)} %`;
  const agg = (arm: string, illum: boolean) => {
    const rs = rows.filter((r) => r.arm === arm && r.illum === illum);
    const n = rs.length;
    return {
      cer: rs.reduce((s, r) => s + r.cer, 0) / n,
      hits: rs.reduce((s, r) => s + r.hits, 0),
      known: rs.reduce((s, r) => s + r.known, 0),
      r14: rs.filter((r) => r.r14).length,
      r19: rs.filter((r) => r.r19).length,
      cleared: rs.filter((r) => r.cleared).length,
      conf: rs.reduce((s, r) => s + r.confidence, 0) / n,
      n,
    };
  };
  const table = [
    "| Capture | Illumination | CER | Critical values found | R-14 fires | R-19 fires | Auto-clears (known-good extraction) | Mean OCR confidence |",
    "|---|---|---|---|---|---|---|---|",
    ...ARMS.flatMap((a) =>
      [false, true].map((illum) => {
        const s = agg(a.label, illum);
        return `| ${a.label} | ${illum ? "**on**" : "off"} | ${p(s.cer)} | ${s.hits}/${s.known} (${p(s.hits / s.known)}) | ${s.r14}/${s.n} | ${s.r19}/${s.n} | ${s.cleared}/${s.n} | ${s.conf.toFixed(3)} |`;
      }),
    ),
  ].join("\n");

  // ── optional live confirmation: shadow arm, illumination on, at most 20 calls ───────────────────────────────
  let live = "";
  if (LIVE) {
    if (process.env.AI_MODE !== "live" || !process.env.DEEPSEEK_API_KEY) {
      console.log("--live skipped: needs AI_MODE=live and DEEPSEEK_API_KEY.");
    } else {
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
      const res: { bad: boolean; escalated: boolean; cleared: boolean; err: boolean; correct: number; returned: number }[] = [];
      for (const c of picked) {
        const r = rows.find((x) => x.arm === "shadow (one third)" && x.illum && x.claimId === c.claimId)!;
        const file = path.join(cache, `x-${createHash("sha256").update(`${r.text}|${c.category}|${PROMPT_VERSION_EXTRACT}`).digest("hex").slice(0, 32)}.json`);
        let x: import("../src/lib/domain/schemas").Extraction;
        if (existsSync(file)) x = JSON.parse(await readFile(file, "utf8"));
        else {
          const out = await extractWithDeepSeek(r.text, { category: c.category }, `bench-illum-${c.claimId}`);
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
        const err = outcomes.some((o) => o === "wrong" || o === "missed");
        const cleared = result.decision === "AUTO_APPROVE";
        res.push({
          bad: !(cleared && !err),
          escalated: result.findings.some((f) => ["R-14", "R-19", "R-20"].includes(f.ruleId)),
          cleared,
          err,
          correct: outcomes.filter((o) => o === "correct").length,
          returned: outcomes.filter((o) => o === "correct" || o === "wrong").length,
        });
      }
      const n = res.length;
      const cleared = res.filter((r) => r.cleared);
      const correct = res.reduce((s, r) => s + r.correct, 0);
      const returned = res.reduce((s, r) => s + r.returned, 0);
      const esc = res.filter((r) => r.escalated).length;
      live = [
        "| Shadow arm, live model | Field accuracy | Escalation (R-14 / R-19 / R-20) | Error in auto-cleared | bad |",
        "|---|---|---|---|---|",
        "| illumination off (Task 14, D-48) | 50.0 % (20/40) | 100.0 % (20/20) | — (0/0) | 20/20 |",
        `| illumination **on** | ${p(correct / returned)} (${correct}/${returned}) | ${p(esc / n)} (${esc}/${n}) | ${cleared.length ? p(cleared.filter((r) => r.err).length / cleared.length) : "—"} (${cleared.filter((r) => r.err).length}/${cleared.length}) | ${res.filter((r) => r.bad).length}/${n} |`,
        "",
        `Model calls this run: ${calls} (${inTok} input / ${outTok} output tokens); the rest came from the cache.`,
      ].join("\n");
      console.log(live);
    }
  }

  const END = "<!-- results:end -->";
  const block = [
    "<!-- results:start (generated by pnpm bench:illumination; do not edit by hand) -->",
    "",
    `Documents: **${picked.length}** (${picked.map((c) => c.claimId).join(", ")}). Clean renders at ≈ 300 dpi, the capture arms of \`src/lib/bench/capture.ts\`, Tesseract \`eng\`, grayscale clean-up, PSM 3.`,
    "",
    table,
    ...(live ? ["", "Live confirmation (one run, at most 20 calls):", "", live] : []),
    "",
    END,
  ].join("\n");
  const docPath = path.resolve("docs/ILLUMINATION.md");
  const existing = existsSync(docPath) ? await readFile(docPath, "utf8") : `# Illumination normalisation\n\n<!-- results:start -->${END}\n`;
  const s0 = existing.indexOf("<!-- results:start");
  const e0 = existing.indexOf(END);
  // A model-free re-run keeps an earlier live block rather than dropping it.
  const old = s0 >= 0 && e0 > s0 ? existing.slice(s0, e0) : "";
  const keepLive = !live && old.includes("Live confirmation") ? old.slice(old.indexOf("Live confirmation")).trimEnd() : "";
  const finalBlock = keepLive ? block.replace(`\n\n${END}`, `\n\n${keepLive}\n\n${END}`) : block;
  await writeFile(docPath, s0 >= 0 && e0 > s0 ? `${existing.slice(0, s0)}${finalBlock}${existing.slice(e0 + END.length)}` : `${existing.trimEnd()}\n\n${finalBlock}\n`);
  console.log(table);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
