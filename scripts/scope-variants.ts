// Scope arms (Task 16 Part A, DECISIONS D-56) → docs/SCOPE.md + docs/scope.csv. What else is in the photo?
//   S0 one invoice filling the frame (control) · S1 two invoices side by side (target = LEFT) ·
//   S2 invoice + background text (a printed page's corner, a shipping label) · S3 one edge out of frame.
// 20 documents per arm, the same bench claims as every other benchmark. Each scene goes through the UPLOAD path:
// page detection + rectification (D-50), illumination normalisation (D-52), grayscale clean-up, Tesseract, word
// boxes mapped back to the photo. Model-free metrics: CER against the target's transcript, the target's critical
// values found, R-14 / R-19 with the target's known-good extraction, and the OTHER document's critical values present
// in the OCR text (exposure: what a model could bind). The other document differs from the target in every field;
// in S2 its values are also on the shipping label.
// `--live S1[,S2]` adds wrong-document bindings measured with the live model (at most 20 calls per arm; needs
// AI_MODE=live and a key): extracted values that equal the other document's and not the target's.
// Usage: pnpm bench:scope [--live S1]   (needs ./eng.traineddata; exits 0 with a message otherwise)
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { CORNER_DETECTOR_VERSION } from "../src/lib/ai/corners";
import { OCR_PIPELINE, OCR_PREP_VERSION } from "../src/lib/ai/ocr-prep";
import { openHarness, pickBenchClaims, skipWithoutModel } from "./lib/ocr-harness";

const liveArg = process.argv.indexOf("--live");
const LIVE_ARMS = new Set(liveArg >= 0 ? (process.argv[liveArg + 1] ?? "S1").split(",") : []);
const CACHE = path.resolve(".bench-cache/scope");

async function main() {
  skipWithoutModel("bench:scope");
  if (existsSync(".env")) process.loadEnvFile(".env");
  const V = await import("../src/lib/bench/variants");
  const C = await import("../src/lib/bench/capture");
  const M = await import("../src/lib/bench/ocr-metrics");
  const S = await import("../src/lib/bench/scope");
  const { plan, picked, inputFor } = await pickBenchClaims(Number(process.env.SCOPE_DOCS ?? 20)); // SCOPE_DOCS: smoke runs only
  const truthOf = (id: string) => plan.fixtures.get(id)!.fixture.extraction;
  await mkdir(CACHE, { recursive: true });

  // The other document: the next seeded claim (by ID, cyclic) whose five critical values ALL differ from the
  // target's and that has a PO, so every field has a wrong value available to bind.
  const pool = [...plan.claims].sort((a, b) => (a.claimId < b.claimId ? -1 : 1));
  const differs = (a: string, b: string) => V.BENCH_FIELDS.every((f) => !["correct", "correct-null"].includes(V.fieldOutcome(f, truthOf(b), truthOf(a))));
  const partnerOf = (id: string) => {
    const i = pool.findIndex((c) => c.claimId === id);
    for (let k = 1; k < pool.length; k++) {
      const c = pool[(i + k) % pool.length];
      if (c.doc.poNumber && differs(id, c.claimId)) return c;
    }
    throw new Error(`no partner for ${id}`);
  };

  const labelHtml = (d: (typeof pool)[number]["doc"]) =>
    `<div style="width:400px;padding:18px 22px;font:15px Arial,sans-serif;color:#111;background:#fff;border:2px solid #111;box-sizing:border-box">
      <div style="font-weight:700;font-size:20px;border-bottom:2px solid #111;padding-bottom:6px">SHIPPING LABEL</div>
      <div style="margin-top:8px">FROM: ${d.vendor.name}</div><div>${d.vendor.cityState}</div>
      <div style="margin-top:8px">SHIP TO: ${d.shipTo.plant}</div>
      <div style="margin-top:8px">PO ${d.poNumber}</div><div>Ref ${d.invoiceNumber}</div><div>Ship date ${d.invoiceDate}</div>
      <div>Declared value $${(truthOf(d.claimId).total ?? 0).toFixed(2)}</div>
      <div style="margin-top:8px;font:700 22px monospace">1Z 9W4 7A1 03 4417 2290</div></div>`;

  const h = await openHarness();
  type Row = {
    arm: string; claimId: string; partnerId: string; index: number; scope: string; reason: string; source: string; verdict: string; meanErrPx: number | null;
    cer: number; hits: number; known: number; r14: boolean; r19: boolean; cleared: boolean; otherHits: number; otherKnown: number; confidence: number; text: string; words: unknown;
  };
  const rows: Row[] = [];
  // Control for the crop: S1 and S2 read as the whole frame (rectification off), as OCR_RECTIFY=off would.
  type OffRow = { arm: string; hits: number; known: number; otherHits: number; otherKnown: number; cleared: boolean };
  const off: OffRow[] = [];
  try {
    for (const [index, c] of picked.entries()) {
      const partner = partnerOf(c.claimId);
      const target = C.decodePng(await h.render(V.variantHtml(c.doc, "canonical", "label-left"), 850, 3));
      const other = C.decodePng(await h.render(V.variantHtml(partner.doc, "canonical", "label-left"), 850, 3));
      const label = C.decodePng(await h.render(`<body style="margin:0;background:#fff">${labelHtml(partner.doc)}</body>`, 400, 3, 330));
      for (const arm of S.SCOPE_ARMS) {
        const file = path.join(CACHE, `scene-${createHash("sha256").update(`${c.claimId}|${partner.claimId}|${arm.id}|${S.SCOPE_VERSION}`).digest("hex").slice(0, 24)}.png`);
        let png: Buffer;
        let quads: { target: import("../src/lib/bench/scope").Quad; other: import("../src/lib/bench/scope").Quad | null; frame: { w: number; h: number } };
        const meta = `${file}.json`;
        if (existsSync(file) && existsSync(meta)) {
          png = await readFile(file);
          quads = JSON.parse(await readFile(meta, "utf8"));
        } else {
          const scene = S.buildScene(arm.id, { target, other, label }, c.claimId, index);
          png = C.encodePng(scene.image);
          quads = { target: scene.target, other: scene.other, frame: { w: scene.image.width, h: scene.image.height } };
          await writeFile(file, png);
          await writeFile(meta, JSON.stringify(quads));
        }
        const o = await h.ocr(png, "image/png", { upload: true });
        const r = o.rectify;
        const visible = arm.id === "S3" ? S.clipRight(quads.target, quads.frame.w) : quads.target;
        const v = r?.scope === "page" ? S.cropVerdict(r.corners, visible, quads.other, quads.frame) : { verdict: "none (full frame)", meanErrPx: null };
        const input = inputFor(c);
        const risk = M.knownGoodRisk(input, o.text, o.confidence);
        const oh = M.criticalHits(inputFor(partner), o.text);
        if (arm.id === "S1" || arm.id === "S2") {
          const f = await h.ocr(png, "image/png");
          const fo = M.criticalHits(inputFor(partner), f.text);
          off.push({ arm: arm.id, ...M.criticalHits(input, f.text), otherHits: fo.hits, otherKnown: fo.known, cleared: M.knownGoodRisk(input, f.text, f.confidence).decision === "AUTO_APPROVE" });
        }
        rows.push({
          arm: arm.id, claimId: c.claimId, partnerId: partner.claimId, index, scope: r?.scope ?? "—", reason: r?.reason ?? "—", source: r?.source ?? "—", verdict: v.verdict, meanErrPx: v.meanErrPx,
          cer: M.cer(o.text, V.variantTranscript(c.doc, "canonical")), ...M.criticalHits(input, o.text), r14: risk.r14, r19: risk.r19, cleared: risk.decision === "AUTO_APPROVE",
          otherHits: oh.hits, otherKnown: oh.known, confidence: o.confidence, text: o.text, words: o.words,
        });
      }
      console.log(`  ${c.claimId} (other ${partner.claimId}) done — ${h.freshOcrRuns()} fresh OCR runs so far`);
    }
  } finally {
    await h.close();
  }

  // ── optional live: wrong-document bindings ────────────────────────────────────────────────────────────────
  type Live = { calls: number; inTok: number; outTok: number; docs: number; bindings: number; docsWithBinding: number; escalated: number; cleared: number; clearedWithBinding: number; clearedWithError: number; rules: Record<string, number> };
  const live = new Map<string, Live>();
  if (LIVE_ARMS.size) {
    if (process.env.AI_MODE !== "live" || !process.env.DEEPSEEK_API_KEY) console.log("--live skipped: needs AI_MODE=live and DEEPSEEK_API_KEY.");
    else {
      const { extractWithDeepSeek } = await import("../src/lib/ai/deepseek");
      const { groundExtraction } = await import("../src/lib/ai/grounding");
      const { presenceOf } = await import("../src/lib/ai/presence");
      const { evaluateRisk } = await import("../src/lib/risk/score");
      const { PROMPT_VERSION_EXTRACT } = await import("../src/lib/domain/constants");
      for (const armId of LIVE_ARMS) {
        const L: Live = { calls: 0, inTok: 0, outTok: 0, docs: 0, bindings: 0, docsWithBinding: 0, escalated: 0, cleared: 0, clearedWithBinding: 0, clearedWithError: 0, rules: {} };
        for (const r of rows.filter((x) => x.arm === armId)) {
          const c = picked.find((x) => x.claimId === r.claimId)!;
          const file = path.join(CACHE, `x-${createHash("sha256").update(`${r.text}|${c.category}|${PROMPT_VERSION_EXTRACT}`).digest("hex").slice(0, 32)}.json`);
          let x: import("../src/lib/domain/schemas").Extraction;
          if (existsSync(file)) x = JSON.parse(await readFile(file, "utf8"));
          else {
            if (L.calls >= 20) break;
            const out = await extractWithDeepSeek(r.text, { category: c.category }, `bench-scope-${armId}-${c.claimId}`);
            L.calls++;
            L.inTok += out.usage.inputTokens;
            L.outTok += out.usage.outputTokens;
            x = out.extraction;
            await writeFile(file, JSON.stringify(x));
          }
          // As for an upload: OCR confidence, grounding, presence with the word boxes (D-55), the real engine.
          const conf = Object.fromEntries(V.BENCH_FIELDS.map((f) => [f, r.confidence]));
          let e = { ...x, fieldConfidence: { ...x.fieldConfidence, ...conf }, boundingBoxes: [] };
          e = { ...e, fieldChecks: groundExtraction(e, r.text) };
          e = { ...e, fieldPresence: presenceOf(e, r.text, { words: r.words as never, size: null }) };
          const result = evaluateRisk({ ...inputFor(c), extraction: e });
          const truth = truthOf(r.claimId);
          const otherTruth = truthOf(r.partnerId);
          const bound = V.BENCH_FIELDS.filter((f) => V.fieldOutcome(f, e, otherTruth) === "correct" && V.fieldOutcome(f, e, truth) !== "correct").length;
          const err = V.BENCH_FIELDS.some((f) => ["wrong", "missed"].includes(V.fieldOutcome(f, e, truth)));
          const cleared = result.decision === "AUTO_APPROVE";
          L.docs++;
          L.bindings += bound;
          if (bound) L.docsWithBinding++;
          if (result.findings.some((f) => ["R-14", "R-19", "R-20"].includes(f.ruleId))) L.escalated++;
          if (cleared) {
            L.cleared++;
            if (bound) L.clearedWithBinding++;
            if (err) L.clearedWithError++;
          }
          for (const f of result.findings) L.rules[f.ruleId] = (L.rules[f.ruleId] ?? 0) + 1;
        }
        live.set(armId, L);
        console.log(`live ${armId}:`, JSON.stringify(L));
      }
    }
  }

  // ── write ───────────────────────────────────────────────────────────────────────────────────────────────────
  const csvCell = (v: unknown) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ["arm", "claim_id", "other_claim_id", "scope", "reason", "source", "crop", "crop_mean_err_px", "cer", "critical_found", "critical_known", "r14", "r19", "auto_clears_known_good", "other_values_in_text", "other_known", "ocr_confidence"];
  await writeFile(
    path.resolve("docs/scope.csv"),
    `${[header.join(","), ...rows.map((r) => [r.arm, r.claimId, r.partnerId, r.scope, r.reason, r.source, r.verdict, r.meanErrPx ?? "", r.cer.toFixed(4), r.hits, r.known, r.r14, r.r19, r.cleared, r.otherHits, r.otherKnown, r.confidence.toFixed(3)].map(csvCell).join(","))].join("\n")}\n`,
  );
  const p = (x: number) => `${(x * 100).toFixed(1)} %`;
  const count = (rs: Row[], key: (r: Row) => string) => {
    const m = new Map<string, number>();
    for (const r of rs) m.set(key(r), (m.get(key(r)) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(" · ");
  };
  const table = [
    "| Arm | Detection (scope · reason) | Region chosen | CER | Target values found | R-14 / R-19 (known-good) | Escalated (known-good) | Other document's values in OCR text | Mean confidence |",
    "|---|---|---|---|---|---|---|---|---|",
    ...S.SCOPE_ARMS.map((a) => {
      const rs = rows.filter((r) => r.arm === a.id);
      const n = rs.length;
      const sum = (f: (r: Row) => number) => rs.reduce((s, r) => s + f(r), 0);
      const other = sum((r) => r.otherKnown);
      return `| ${a.label} | ${count(rs, (r) => `${r.scope} · ${r.reason}`)} | ${count(rs, (r) => r.verdict)} | ${p(sum((r) => r.cer) / n)} | ${sum((r) => r.hits)}/${sum((r) => r.known)} (${p(sum((r) => r.hits) / sum((r) => r.known))}) | ${rs.filter((r) => r.r14).length} / ${rs.filter((r) => r.r19).length} of ${n} | ${rs.filter((r) => !r.cleared).length}/${n} | ${a.id === "S0" || a.id === "S3" ? "— (none in scene)" : `${sum((r) => r.otherHits)}/${other} in ${rs.filter((r) => r.otherHits > 0).length}/${n} docs`} | ${(sum((r) => r.confidence) / n).toFixed(3)} |`;
    }),
  ].join("\n");
  // S1 split by which page was nearer the camera (larger), to show "the largest page wins".
  const s1 = rows.filter((r) => r.arm === "S1");
  const split = [
    "| S1 condition | Docs | Region chosen |",
    "|---|---|---|",
    `| target (left) page 4 % larger | ${s1.filter((r) => r.index % 2 === 0).length} | ${count(s1.filter((r) => r.index % 2 === 0), (r) => r.verdict)} |`,
    `| other (right) page 4 % larger | ${s1.filter((r) => r.index % 2 === 1).length} | ${count(s1.filter((r) => r.index % 2 === 1), (r) => r.verdict)} |`,
  ].join("\n");
  const offTable = [
    "| Control: rectification off (whole frame read) | Target values found | Other document's values in OCR text | Escalated (known-good) |",
    "|---|---|---|---|",
    ...["S1", "S2"].map((armId) => {
      const rs = off.filter((r) => r.arm === armId);
      const sum = (f: (r: OffRow) => number) => rs.reduce((s, r) => s + f(r), 0);
      return `| ${S.SCOPE_ARMS.find((a) => a.id === armId)!.label} | ${sum((r) => r.hits)}/${sum((r) => r.known)} (${p(sum((r) => r.hits) / sum((r) => r.known))}) | ${sum((r) => r.otherHits)}/${sum((r) => r.otherKnown)} in ${rs.filter((r) => r.otherHits > 0).length}/${rs.length} docs | ${rs.filter((r) => !r.cleared).length}/${rs.length} |`;
    }),
  ].join("\n");
  const liveBlock = [...live.entries()].map(([armId, L]) =>
    [
      `| Live, ${armId} | Docs | Wrong-document bindings (fields) | Docs with a binding | Escalated (R-14 / R-19 / R-20) | Auto-approved | …with a wrong-document binding | …with any wrong field | Rules fired |`,
      "|---|---|---|---|---|---|---|---|---|",
      `| ${S.SCOPE_ARMS.find((a) => a.id === armId)?.label ?? armId} | ${L.docs} | ${L.bindings}/${L.docs * V.BENCH_FIELDS.length} | ${L.docsWithBinding}/${L.docs} | ${L.escalated}/${L.docs} | ${L.cleared} | **${L.clearedWithBinding}** | ${L.clearedWithError} | ${Object.entries(L.rules).sort().map(([k, n]) => `${k} ${n}`).join(", ")} |`,
      "",
      `Model calls this run: ${L.calls} (${L.inTok} input / ${L.outTok} output tokens); the rest came from the cache.`,
    ].join("\n"),
  );
  const END = "<!-- results:end -->";
  const block = [
    "<!-- results:start (generated by pnpm bench:scope; do not edit by hand) -->",
    "",
    `Pipeline: illumination normalisation ${OCR_PIPELINE.illumination ? "on" : "off"} (D-52), rectification on (D-50, detector \`${CORNER_DETECTOR_VERSION}\`). OCR clean-up \`${OCR_PREP_VERSION}\`, scenes \`${S.SCOPE_VERSION}\`.`,
    "",
    `Documents: **${picked.length}** per arm (${picked.map((c) => c.claimId).join(", ")}). Raw rows: [\`docs/scope.csv\`](scope.csv).`,
    "",
    table,
    "",
    split,
    "",
    offTable,
    ...(liveBlock.length ? ["", "Live (wrong-document bindings; at most 20 calls per arm):", "", ...liveBlock] : []),
    "",
    END,
  ].join("\n");
  const docPath = path.resolve("docs/SCOPE.md");
  const existing = existsSync(docPath) ? await readFile(docPath, "utf8") : `# Scope: what else is in the photo\n\n<!-- results:start -->${END}\n`;
  const s0 = existing.indexOf("<!-- results:start");
  const e0 = existing.indexOf(END);
  const old = s0 >= 0 && e0 > s0 ? existing.slice(s0, e0) : "";
  const keepLive = !liveBlock.length && old.includes("Live (wrong-document") ? old.slice(old.indexOf("Live (wrong-document")).trimEnd() : "";
  const finalBlock = keepLive ? block.replace(`\n\n${END}`, `\n\n${keepLive}\n\n${END}`) : block;
  await writeFile(docPath, s0 >= 0 && e0 > s0 ? `${existing.slice(0, s0)}${finalBlock}${existing.slice(e0 + END.length)}` : `${existing.trimEnd()}\n\n${finalBlock}\n`);
  console.log(table);
  console.log(split);
  console.log(offTable);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
