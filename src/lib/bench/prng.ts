// Deterministic randomness for the grounding benchmark: same seed ⇒ same degradations ⇒ same numbers.

/** FNV-1a 32-bit hash of a string, used to derive per-document seeds. */
export function hashSeed(...parts: (string | number)[]): number {
  let h = 0x811c9dc5;
  for (const ch of parts.join("|")) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32: small, fast, well-distributed 32-bit PRNG returning floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Degradation = { seed: number; blurSigma: number; rotateDeg: number; jpegQuality: number; scale: number; contrast: number };

const range = (r: () => number, lo: number, hi: number, digits = 2) => Number((lo + (hi - lo) * r()).toFixed(digits));

/** Degradation parameters for one document, within the ranges agreed for the benchmark (Task 7). */
export function degradationFor(seed: number): Degradation {
  const r = mulberry32(seed);
  return {
    seed,
    blurSigma: range(r, 0.5, 2),
    rotateDeg: range(r, -2, 2),
    jpegQuality: Math.round(range(r, 40, 70, 0)),
    scale: range(r, 0.5, 0.7),
    contrast: range(r, 0.85, 1.15), // mild
  };
}
