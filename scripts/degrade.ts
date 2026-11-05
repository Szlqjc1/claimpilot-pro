// Degraded-OCR corpus for docs/GROUNDING_BENCH.md (population A). Read-only: no DB, no model calls.
// Each document = one seeded fixture SVG, rendered in headless Chromium (Playwright) onto a canvas with a seeded
// Gaussian blur, rotation, mild contrast shift and downscale, encoded as JPEG, then read by the REAL Tesseract.
// Results are cached under .bench-cache/ (gitignored), keyed by claim, variant and degradation seed.
//
// Standalone:  pnpm bench:degrade   (fills the cache; pnpm bench:grounding reuses it)
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { cpus } from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { buildSeedPlan } from "../src/lib/seed/run";
import { degradationFor, hashSeed, type Degradation } from "../src/lib/bench/prng";

export const CACHE_DIR = path.resolve(".bench-cache");
export const MODEL_PATH = path.resolve("eng.traineddata");
/**
 * Base resolution: the fixture SVG (1200 px wide) is treated as a letter-size page rendered at 300 dpi
 * (2550 px wide), then downscaled 50–70 % (≈ 150–210 dpi, a typical office scan). Rendering at the SVG's native
 * 1200 px (≈ 140 dpi) already makes Tesseract misread clean digits, which would measure the renderer, not grounding.
 */
export const BASE_SCALE = 2550 / 1200;
/** Bump when rendering or degradation changes, so cached OCR from an older pipeline is never reused. */
export const RENDER_VERSION = "r2-300dpi";
export const MODEL_URL = "https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz";

export type DegradedDoc = { docId: string; claimId: string; variant: number; params: Degradation; text: string; ocrConfidence: number; cached: boolean };

/** The Tesseract model is gitignored; never fall back to a silent download or skip the corpus. */
export function requireTesseractModel(): void {
  if (existsSync(MODEL_PATH)) return;
  console.error(
    [
      `Tesseract language model not found at ${MODEL_PATH}.`,
      "The degraded corpus needs the real Tesseract model; it is gitignored and not downloaded automatically.",
      `Download:  ${MODEL_URL}`,
      "Then gunzip it into the repository root as eng.traineddata, e.g.:",
      `  curl -L ${MODEL_URL} | gunzip > eng.traineddata`,
    ].join("\n"),
  );
  process.exit(1);
}

const cacheFile = (claimId: string, variant: number, d: Degradation) => path.join(CACHE_DIR, `${claimId}-v${variant}-${d.seed.toString(16)}-${RENDER_VERSION}.json`);

/** `control: true` renders the same documents with no degradation (300 dpi, JPEG 95) as a pipeline check. */
export async function degradeCorpus(opts: { seed: number; variants: number; control?: boolean; log?: (m: string) => void }): Promise<DegradedDoc[]> {
  requireTesseractModel();
  const log = opts.log ?? (() => {});
  await mkdir(CACHE_DIR, { recursive: true });
  const plan = buildSeedPlan();
  const jobs = plan.claims.flatMap((c) =>
    Array.from({ length: opts.variants }, (_, v) => ({
      claimId: c.claimId,
      variant: v,
      params: opts.control
        ? { seed: hashSeed(opts.seed, c.claimId, "control"), blurSigma: 0, rotateDeg: 0, jpegQuality: 95, scale: 1, contrast: 1 }
        : degradationFor(hashSeed(opts.seed, c.claimId, v)),
    })),
  );

  const out: DegradedDoc[] = [];
  const todo: typeof jobs = [];
  for (const j of jobs) {
    const f = cacheFile(j.claimId, j.variant, j.params);
    if (existsSync(f)) {
      const hit = JSON.parse(await readFile(f, "utf8")) as { text: string; ocrConfidence: number };
      out.push({ docId: `${j.claimId}#v${j.variant}`, ...j, text: hit.text, ocrConfidence: hit.ocrConfidence, cached: true });
    } else todo.push(j);
  }
  log(`${opts.control ? "control" : "degraded"} corpus: ${jobs.length} documents, ${jobs.length - todo.length} cached, ${todo.length} to OCR`);
  if (todo.length === 0) return sortDocs(out);

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent("<!doctype html><html><body></body></html>");
  const { createScheduler, createWorker } = await import("tesseract.js");
  const scheduler = createScheduler();
  const workers = Math.max(1, Math.min(8, cpus().length - 2));
  for (let i = 0; i < workers; i++) {
    // Read ./eng.traineddata from the local cache only: no network, no writes.
    scheduler.addWorker(await createWorker("eng", 1, { cachePath: path.dirname(MODEL_PATH), cacheMethod: "readOnly", langPath: path.dirname(MODEL_PATH), gzip: false }));
  }
  try {
    let done = 0;
    const started = Date.now();
    await Promise.all(
      todo.map(async (j) => {
        const svg = plan.fixtures.get(j.claimId)!.svg;
        const jpegB64 = await render(page, svg, j.params);
        const { data } = await scheduler.addJob("recognize", Buffer.from(jpegB64, "base64"));
        const text = data.text;
        const ocrConfidence = Math.max(0, Math.min(1, (data.confidence ?? 0) / 100));
        await writeFile(cacheFile(j.claimId, j.variant, j.params), JSON.stringify({ params: j.params, ocrConfidence, text }));
        out.push({ docId: `${j.claimId}#v${j.variant}`, ...j, text, ocrConfidence, cached: false });
        if (++done % 50 === 0 || done === todo.length) log(`  OCR ${done}/${todo.length} (${Math.round((Date.now() - started) / 1000)} s, ${workers} workers)`);
      }),
    );
  } finally {
    await scheduler.terminate();
    await browser.close();
  }
  return sortDocs(out);
}

const sortDocs = (docs: DegradedDoc[]) => docs.sort((a, b) => (a.claimId === b.claimId ? a.variant - b.variant : a.claimId < b.claimId ? -1 : 1));

// Rendering is serialised on one page (canvas work is fast); OCR runs in parallel in the scheduler.
let renderQueue: Promise<unknown> = Promise.resolve();
function render(page: import("playwright").Page, svg: string, p: Degradation): Promise<string> {
  const run = renderQueue.then(() =>
    page.evaluate(
      async ({ svg, p, base }) => {
        const img = new Image();
        img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
        await img.decode();
        const W = Math.round(1200 * base * p.scale);
        const H = Math.round(1600 * base * p.scale);
        const c = document.createElement("canvas");
        c.width = W;
        c.height = H;
        const ctx = c.getContext("2d")!;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, W, H);
        // σ is applied in output pixels (after downscaling), the harsher reading of "σ 0.5–2".
        if (p.blurSigma > 0 || p.contrast !== 1) ctx.filter = `blur(${p.blurSigma}px) contrast(${p.contrast})`;
        ctx.translate(W / 2, H / 2);
        ctx.rotate((p.rotateDeg * Math.PI) / 180);
        ctx.drawImage(img, -W / 2, -H / 2, W, H);
        return c.toDataURL("image/jpeg", p.jpegQuality / 100).split(",")[1];
      },
      { svg, p, base: BASE_SCALE },
    ),
  );
  renderQueue = run.catch(() => {});
  return run;
}

// Standalone entry point: fill the cache.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  const seed = Number(process.env.BENCH_SEED ?? 20261105);
  const variants = Number(process.env.BENCH_VARIANTS ?? 5);
  degradeCorpus({ seed, variants, log: console.log })
    .then((docs) => console.log(`done: ${docs.length} degraded documents in ${CACHE_DIR}`))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
