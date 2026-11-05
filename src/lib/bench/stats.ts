// Interval helpers for docs/GROUNDING_BENCH.md. Exact one-sided Clopper–Pearson bounds via the binomial CDF;
// pure, no dependencies. With zero failures they reduce to the rule-of-three family: 1 − α^(1/n).

function logGamma(x: number): number {
  // Lanczos approximation (g = 7, n = 9); accurate to ~1e-15 for x > 0.
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  x -= 1;
  let a = c[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

const logChoose = (n: number, k: number) => logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1);

/** P(X ≤ k) for X ~ Binomial(n, p). */
export function binomialCdf(k: number, n: number, p: number): number {
  if (k < 0) return 0;
  if (k >= n) return 1;
  if (p <= 0) return 1;
  if (p >= 1) return 0;
  let s = 0;
  for (let i = 0; i <= k; i++) s += Math.exp(logChoose(n, i) + i * Math.log(p) + (n - i) * Math.log1p(-p));
  return Math.min(1, s);
}

function bisect(f: (p: number) => number, lo = 0, hi = 1): number {
  // f is monotone on [lo, hi] with a sign change; 100 iterations ≈ 1e-30 precision.
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** One-sided upper (1 − α) bound on a rate after k events in n trials (e.g. false-alarm rate). */
export function upperBound(k: number, n: number, alpha = 0.05): number {
  if (n <= 0) return 1;
  if (k >= n) return 1;
  // Largest p with P(X ≤ k | p) ≥ α.
  return bisect((p) => binomialCdf(k, n, p) - alpha);
}

/** One-sided lower (1 − α) bound on a rate after k successes in n trials (e.g. recall). */
export function lowerBound(k: number, n: number, alpha = 0.05): number {
  if (n <= 0 || k <= 0) return 0;
  // Smallest p with P(X ≥ k | p) ≥ α, i.e. 1 − P(X ≤ k − 1 | p) ≥ α.
  return bisect((p) => alpha - (1 - binomialCdf(k - 1, n, p)));
}

/** Trials needed so that zero failures demonstrate `target` at confidence 1 − α: n = ln(α) / ln(target). */
export function requiredN(target: number, alpha = 0.05): number {
  return Math.ceil(Math.log(alpha) / Math.log(target));
}

export const pct = (x: number, digits = 2) => `${(x * 100).toFixed(digits)} %`;
