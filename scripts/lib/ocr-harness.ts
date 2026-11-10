// Shared, model-free OCR harness for scripts/illumination-ab.ts and scripts/resolution-sweep.ts (D-52, D-53):
// render HTML in headless Chromium, run the app's own OCR preparation and the real Tesseract, cache the text.
// No DB, no model. Needs ./eng.traineddata; without it, callers print why and exit 0.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { OCR_PIPELINE, OCR_PREP_VERSION, prepareForOcr } from "../../src/lib/ai/ocr-prep";

export const MODEL_PATH = path.resolve("eng.traineddata");
const CACHE = path.resolve(".bench-cache/ocr-harness");
const sha = (b: string | Buffer) => createHash("sha256").update(b).digest("hex").slice(0, 32);

export type OcrOut = { text: string; confidence: number };

export async function openHarness() {
  await mkdir(CACHE, { recursive: true });
  const browser: Browser = await chromium.launch();
  const pages = new Map<string, Page>();
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng", 1, { cachePath: path.dirname(MODEL_PATH), cacheMethod: "readOnly", langPath: path.dirname(MODEL_PATH), gzip: false });
  if (OCR_PIPELINE.psm !== "default") await worker.setParameters({ tessedit_pageseg_mode: OCR_PIPELINE.psm as never });
  let fresh = 0;

  return {
    /** Screenshot of `html` at `cssWidth` CSS px × `scale`; `cssHeight` clips (fixed page size) or omit for full page. */
    async render(html: string, cssWidth: number, scale: number, cssHeight?: number): Promise<Buffer> {
      const key = `${cssWidth}x${scale}`;
      let page = pages.get(key);
      if (!page) {
        page = await browser.newPage({ viewport: { width: cssWidth, height: cssHeight ?? 1100 }, deviceScaleFactor: scale });
        pages.set(key, page);
      }
      await page.setContent(html, { waitUntil: "load" });
      return page.screenshot({ type: "png", fullPage: cssHeight === undefined });
    },
    /** Measure a glyph box: the height in device px of the dark pixels of `html` (rendered at the given scale). */
    async inkHeight(html: string, scale: number): Promise<number> {
      const page = await browser.newPage({ viewport: { width: 800, height: 300 }, deviceScaleFactor: scale });
      try {
        await page.setContent(html, { waitUntil: "load" });
        return await page.evaluate(() => 0).then(async () => {
          const png = await page.screenshot({ type: "png" });
          const { PNG } = await import("pngjs");
          const img = PNG.sync.read(png);
          let top = -1;
          let bottom = -1;
          for (let y = 0; y < img.height; y++) {
            for (let x = 0; x < img.width; x++) {
              if (img.data[(y * img.width + x) * 4] < 128) {
                if (top < 0) top = y;
                bottom = y;
                break;
              }
            }
          }
          return top < 0 ? 0 : bottom - top + 1;
        });
      } finally {
        await page.close();
      }
    },
    /** The app's OCR preparation (illumination per argument, default the app's) then Tesseract; cached by bytes. */
    async ocr(image: Buffer, mime: "image/png" | "image/jpeg", opts: { illumination?: boolean } = {}): Promise<OcrOut> {
      const illumination = opts.illumination ?? OCR_PIPELINE.illumination;
      const file = path.join(CACHE, `${sha(image)}-${OCR_PIPELINE.mode}-psm${OCR_PIPELINE.psm}-${OCR_PREP_VERSION}-illum${illumination ? 1 : 0}.json`);
      if (existsSync(file)) return JSON.parse(await readFile(file, "utf8")) as OcrOut;
      const { image: input } = prepareForOcr(image, mime, { mode: OCR_PIPELINE.mode as "gray", psm: OCR_PIPELINE.psm, illumination });
      const { data } = await worker.recognize(input);
      const out: OcrOut = { text: data.text, confidence: Math.max(0, Math.min(1, (data.confidence ?? 0) / 100)) };
      await writeFile(file, JSON.stringify(out));
      fresh++;
      return out;
    },
    freshOcrRuns: () => fresh,
    async close() {
      await worker.terminate();
      await browser.close();
    },
  };
}

export function skipWithoutModel(script: string): void {
  if (existsSync(MODEL_PATH)) return;
  console.log(`${script} skipped — Tesseract model not found at ${MODEL_PATH} (see scripts/degrade.ts). Nothing was written.`);
  process.exit(0);
}

/**
 * The benchmark's 20 documents: seeded claims that AUTO-CLEAR on their reference extraction, evenly spaced by claim
 * ID — the same selection as scripts/extraction-variants.ts, so every benchmark measures the same claims.
 */
export async function pickBenchClaims(n = 20) {
  const { buildSeedPlan, seedRiskInput } = await import("../../src/lib/seed/run");
  const { evaluateRisk } = await import("../../src/lib/risk/score");
  const plan = buildSeedPlan();
  const clean = plan.claims.filter((c) => evaluateRisk(seedRiskInput(plan, c)).decision === "AUTO_APPROVE").sort((a, b) => (a.claimId < b.claimId ? -1 : 1));
  const k = Math.min(n, clean.length);
  const picked = Array.from({ length: k }, (_, i) => clean[Math.floor((i * clean.length) / k)]);
  return { plan, picked, inputFor: (c: (typeof picked)[number]) => seedRiskInput(plan, c) };
}
