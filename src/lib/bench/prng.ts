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

export type DegradationProfile = "harsh" | "realistic";

/** Parameter ranges per profile. `harsh` is exactly Task 7's (kept reproducible); `realistic` is Task 7b A1. */
export const PROFILE_RANGES: Record<DegradationProfile, { blur: [number, number]; rotate: number; jpeg: [number, number]; scale: [number, number]; contrast: [number, number] }> = {
  harsh: { blur: [0.5, 2], rotate: 2, jpeg: [40, 70], scale: [0.5, 0.7], contrast: [0.85, 1.15] },
  realistic: { blur: [0.2, 1], rotate: 1, jpeg: [70, 85], scale: [0.8, 1], contrast: [0.95, 1.05] },
};

/** Degradation parameters for one document. The draw order is fixed, so `harsh` reproduces Task 7 exactly. */
export function degradationFor(seed: number, profile: DegradationProfile = "harsh"): Degradation {
  const r = mulberry32(seed);
  const p = PROFILE_RANGES[profile];
  return {
    seed,
    blurSigma: range(r, p.blur[0], p.blur[1]),
    rotateDeg: range(r, -p.rotate, p.rotate),
    jpegQuality: Math.round(range(r, p.jpeg[0], p.jpeg[1], 0)),
    scale: range(r, p.scale[0], p.scale[1]),
    contrast: range(r, p.contrast[0], p.contrast[1]),
  };
}
