// Degraded-OCR corpus for docs/GROUNDING_BENCH.md (population A). Read-only: no DB, no model calls.
// Each document = one seeded fixture SVG, rendered in headless Chromium (Playwright) onto a canvas with a seeded
// Gaussian blur, rotation, contrast shift and downscale, encoded as JPEG, optionally cleaned up with the app's own
// OCR preparation (src/lib/ai/ocr-prep.ts, on a worker-thread pool), then read by the REAL Tesseract.
// Results are cached under .bench-cache/ (gitignored). The cache key contains the profile, the degradation seed,
// the render version and the OCR pipeline version (prep mode + prep code version + PSM), so OCR text produced by a
// different pipeline is never reused (Task 7b A3).
//
// Standalone:  pnpm bench:degrade   (fills the cache; pnpm bench:grounding reuses it)
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { cpus } from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { chromium } from "playwright";
import { buildSeedPlan } from "../src/lib/seed/run";
import { degradationFor, hashSeed, type Degradation } from "../src/lib/bench/prng";
import { OCR_PREP_VERSION, wordsFromBlocks, type OcrPrep, type PrepMode, type Psm } from "../src/lib/ai/ocr-prep";

export const CACHE_DIR = path.resolve(".bench-cache");
export const MODEL_PATH = path.resolve("eng.traineddata");
export const MODEL_URL = "https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz";

export type Profile = "harsh" | "realistic" | "control";
/**
 * Render base per profile, in px per SVG px (the fixture SVG is 1200 px wide = one letter-size page):
 * harsh/control = 300 dpi (2550 px), realistic = 200 dpi (1700 px). At the SVG's native 1200 px (≈ 140 dpi)
 * Tesseract already misreads clean digits, which would measure the renderer, not grounding.
 */
export const PROFILE_BASE: Record<Profile, number> = { harsh: 2550 / 1200, realistic: 1700 / 1200, control: 2550 / 1200 };
/** Bump when rendering or degradation changes. */
export const RENDER_VERSION = "r2";

export type OcrVariant = { prep: PrepMode; psm: Psm };
export const RAW: OcrVariant = { prep: "off", psm: "default" };
export const ocrVersion = (v: OcrVariant) => `${v.prep === "off" ? "raw" : `${OCR_PREP_VERSION}-${v.prep}`}-psm${v.psm}`;
export const variantLabel = (v: OcrVariant) => `${v.prep === "off" ? "raw" : v.prep === "gray" ? "grayscale clean-up" : "binarised clean-up"} · PSM ${v.psm}`;

export type DegradedDoc = {
  docId: string;
  claimId: string;
  variant: number;
  profile: Profile;
  params: Degradation;
  text: string;
  ocrConfidence: number;
  wordCount: number;
  meanWordConfidence: number;
  prep: OcrPrep | null;
  cached: boolean;
};

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

const paramsFor = (profile: Profile, seed: number, claimId: string, v: number): Degradation => {
  if (profile === "control") return { seed: hashSeed(seed, claimId, "control"), blurSigma: 0, rotateDeg: 0, jpegQuality: 95, scale: 1, contrast: 1 };
  // `harsh` keeps Task 7's exact seed derivation so its numbers stay reproducible.
  if (profile === "harsh") return degradationFor(hashSeed(seed, claimId, v), "harsh");
  return degradationFor(hashSeed(seed, "realistic", claimId, v), "realistic");
};

const cacheFile = (profile: Profile, claimId: string, variant: number, d: Degradation, ocr: OcrVariant) =>
  path.join(CACHE_DIR, `${profile}-${claimId}-v${variant}-${d.seed.toString(16)}-${RENDER_VERSION}-${ocrVersion(ocr)}.json`);

type Cached = { params: Degradation; text: string; ocrConfidence: number; wordCount: number; meanWordConfidence: number; prep: OcrPrep | null };

export async function degradeCorpus(opts: { seed: number; variants: number; profile: Profile; ocr?: OcrVariant; claimIds?: string[]; log?: (m: string) => void }): Promise<DegradedDoc[]> {
  requireTesseractModel();
  const ocr = opts.ocr ?? RAW;
  const log = opts.log ?? (() => {});
  await mkdir(CACHE_DIR, { recursive: true });
  const plan = buildSeedPlan();
  const claims = opts.claimIds ? plan.claims.filter((c) => opts.claimIds!.includes(c.claimId)) : plan.claims;
  const jobs = claims.flatMap((c) => Array.from({ length: opts.variants }, (_, v) => ({ claimId: c.claimId, variant: v, params: paramsFor(opts.profile, opts.seed, c.claimId, v) })));

  const out: DegradedDoc[] = [];
  const todo: typeof jobs = [];
  for (const j of jobs) {
    const f = cacheFile(opts.profile, j.claimId, j.variant, j.params, ocr);
    if (existsSync(f)) {
      const hit = JSON.parse(await readFile(f, "utf8")) as Cached;
      out.push({ docId: `${j.claimId}#v${j.variant}`, ...j, profile: opts.profile, text: hit.text, ocrConfidence: hit.ocrConfidence, wordCount: hit.wordCount, meanWordConfidence: hit.meanWordConfidence, prep: hit.prep, cached: true });
    } else todo.push(j);
  }
  log(`${opts.profile} · ${variantLabel(ocr)}: ${jobs.length} documents, ${jobs.length - todo.length} cached, ${todo.length} to OCR`);
  if (todo.length === 0) return sortDocs(out);

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent("<!doctype html><html><body></body></html>");
  const { createScheduler, createWorker } = await import("tesseract.js");
  const scheduler = createScheduler();
  const n = Math.max(1, Math.min(8, cpus().length - 2));
  for (let i = 0; i < n; i++) {
    // Read ./eng.traineddata from the local cache only: no network, no writes.
    const w = await createWorker("eng", 1, { cachePath: path.dirname(MODEL_PATH), cacheMethod: "readOnly", langPath: path.dirname(MODEL_PATH), gzip: false });
    if (ocr.psm !== "default") await w.setParameters({ tessedit_pageseg_mode: ocr.psm as never });
    scheduler.addWorker(w);
  }
  const pool = ocr.prep === "off" ? null : new PrepPool(n);
  try {
    let done = 0;
    const started = Date.now();
    await Promise.all(
      todo.map(async (j) => {
        const jpeg = Buffer.from(await render(page, plan.fixtures.get(j.claimId)!.svg, j.params, PROFILE_BASE[opts.profile]), "base64");
        let image: Buffer = jpeg;
        let prep: OcrPrep | null = null;
        if (pool) ({ image, prep } = await pool.run(jpeg, ocr));
        const { data } = await scheduler.addJob("recognize", image, {}, { text: true, blocks: true });
        const words = wordsFromBlocks(data.blocks as never, 1, 1);
        const meanWordConfidence = words.length ? Number((words.reduce((s, w) => s + w.confidence, 0) / words.length).toFixed(4)) : 0;
        const entry: Cached = { params: j.params, text: data.text, ocrConfidence: Math.max(0, Math.min(1, (data.confidence ?? 0) / 100)), wordCount: words.length, meanWordConfidence, prep };
        await writeFile(cacheFile(opts.profile, j.claimId, j.variant, j.params, ocr), JSON.stringify(entry));
        out.push({ docId: `${j.claimId}#v${j.variant}`, ...j, profile: opts.profile, ...entry, cached: false });
        if (++done % 100 === 0 || done === todo.length) log(`  OCR ${done}/${todo.length} (${Math.round((Date.now() - started) / 1000)} s, ${n} workers)`);
      }),
    );
  } finally {
    await scheduler.terminate();
    await pool?.close();
    await browser.close();
  }
  return sortDocs(out);
}

const sortDocs = (docs: DegradedDoc[]) => docs.sort((a, b) => (a.claimId === b.claimId ? a.variant - b.variant : a.claimId < b.claimId ? -1 : 1));

/** Round-robin pool of worker threads running the app's prepareForOcr. */
class PrepPool {
  private workers: Worker[];
  private next = 0;
  private seq = 0;
  private pending = new Map<number, (r: { image: Buffer; prep: OcrPrep }) => void>();
  constructor(size: number) {
    this.workers = Array.from({ length: size }, () => {
      const w = new Worker(path.resolve("scripts/prep-worker.ts"));
      w.on("message", (m: { id: number; image: Uint8Array; prep: OcrPrep }) => {
        this.pending.get(m.id)?.({ image: Buffer.from(m.image.buffer, m.image.byteOffset, m.image.byteLength), prep: m.prep });
        this.pending.delete(m.id);
      });
      return w;
    });
  }
  run(jpeg: Buffer, ocr: OcrVariant): Promise<{ image: Buffer; prep: OcrPrep }> {
    const id = this.seq++;
    const w = this.workers[this.next++ % this.workers.length];
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      const copy = new Uint8Array(jpeg);
      w.postMessage({ id, image: copy, mime: "image/jpeg", mode: ocr.prep, psm: ocr.psm }, [copy.buffer]);
    });
  }
  async close() {
    await Promise.all(this.workers.map((w) => w.terminate()));
  }
}

// Rendering is serialised on one page (canvas work is fast); preprocessing and OCR run in parallel.
let renderQueue: Promise<unknown> = Promise.resolve();
function render(page: import("playwright").Page, svg: string, p: Degradation, base: number): Promise<string> {
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
      { svg, p, base },
    ),
  );
  renderQueue = run.catch(() => {});
  return run;
}

// Standalone entry point: fill the cache for one profile and OCR variant.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  const seed = Number(process.env.BENCH_SEED ?? 20261105);
  const variants = Number(process.env.BENCH_VARIANTS ?? 5);
  const profile = (process.env.BENCH_PROFILE ?? "harsh") as Profile;
  degradeCorpus({ seed, variants, profile, log: console.log })
    .then((docs) => console.log(`done: ${docs.length} ${profile} documents in ${CACHE_DIR}`))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
