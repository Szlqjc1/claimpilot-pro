// Worker thread for scripts/degrade.ts: runs the app's own OCR preparation (src/lib/ai/ocr-prep.ts) off the main
// thread so the benchmark can preprocess hundreds of images in parallel. Inherits the tsx loader from the parent.
import { parentPort } from "node:worker_threads";
import { prepareForOcr, type PrepMode, type Psm } from "../src/lib/ai/ocr-prep";

type Job = { id: number; image: Uint8Array; mime: string; mode: Exclude<PrepMode, "off">; psm: Psm };

parentPort!.on("message", (job: Job) => {
  const { image, prep } = prepareForOcr(Buffer.from(job.image), job.mime, { mode: job.mode, psm: job.psm });
  const out = new Uint8Array(image.buffer, image.byteOffset, image.byteLength).slice();
  parentPort!.postMessage({ id: job.id, image: out, prep }, [out.buffer]);
});
