import { formatUsd } from "@/lib/domain/money";
import { DEFAULT_ERROR_PROBABILITY, REVIEW_COST_CENTS } from "@/lib/domain/constants";
import type { CurvePoint } from "@/lib/risk/economics";

// Hand-written SVG for the review cost curve (no chart dependency). Pure: `pnpm cost:curve` writes it to
// docs/images/cost-curve.svg and /economics renders the same chart from live data.

export function costCurveSvg(points: CurvePoint[]): string {
  const W = 720, H = 400, m = { l: 84, r: 24, t: 40, b: 56 };
  const pw = W - m.l - m.r, ph = H - m.t - m.b;
  const maxX = Math.max(...points.map((p) => p.capacityPct));
  const rawMax = Math.max(...points.map((p) => Math.max(p.totalCents, p.reviewCostCents, p.expectedLossCents)));
  const step = niceStep(rawMax / 5);
  const maxY = Math.ceil(rawMax / step) * step || 1;
  const x = (v: number) => m.l + (v / maxX) * pw;
  const y = (v: number) => m.t + ph - (v / maxY) * ph;
  const line = (key: "totalCents" | "reviewCostCents" | "expectedLossCents") => points.map((p, i) => `${i ? "L" : "M"}${x(p.capacityPct).toFixed(1)},${y(p[key]).toFixed(1)}`).join(" ");
  const best = points.reduce((a, b) => (b.totalCents < a.totalCents ? b : a));
  const yTicks = Array.from({ length: Math.round(maxY / step) + 1 }, (_, i) => i * step);
  const xTicks = points.filter((p) => p.capacityPct % 10 === 0).map((p) => p.capacityPct);
  const usd = (c: number) => (c >= 100_000 ? `$${(c / 100_000).toFixed(c % 100_000 ? 1 : 0)}k` : `$${Math.round(c / 100)}`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Inter, system-ui, sans-serif" font-size="12" role="img" aria-labelledby="t d">
  <title id="t">Review cost curve</title>
  <desc id="d">Total cost (review cost plus expected loss left unreviewed) by review capacity. Lowest total at ${best.capacityPct}% capacity: ${formatUsd(best.totalCents)}.</desc>
  <rect width="${W}" height="${H}" fill="#ffffff"/>
  <text x="${m.l}" y="22" font-size="14" font-weight="600" fill="#0f172a">Total cost vs review capacity (p = ${DEFAULT_ERROR_PROBABILITY}, c = ${formatUsd(REVIEW_COST_CENTS)})</text>
${yTicks.map((t) => `  <line x1="${m.l}" x2="${W - m.r}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}" stroke="#e2e8f0"/>\n  <text x="${m.l - 8}" y="${(y(t) + 4).toFixed(1)}" text-anchor="end" fill="#64748b">${usd(t)}</text>`).join("\n")}
${xTicks.map((t) => `  <text x="${x(t).toFixed(1)}" y="${H - m.b + 18}" text-anchor="middle" fill="#64748b">${t}%</text>`).join("\n")}
  <line x1="${m.l}" x2="${W - m.r}" y1="${y(0)}" y2="${y(0)}" stroke="#94a3b8"/>
  <text x="${m.l + pw / 2}" y="${H - 12}" text-anchor="middle" fill="#334155">Review capacity (share of Analyzed claims, highest p·L/c first)</text>
  <text transform="translate(18 ${m.t + ph / 2}) rotate(-90)" text-anchor="middle" fill="#334155">USD</text>
  <path d="${line("expectedLossCents")}" fill="none" stroke="#f97316" stroke-width="2" stroke-dasharray="6 4"/>
  <path d="${line("reviewCostCents")}" fill="none" stroke="#2563eb" stroke-width="2" stroke-dasharray="2 4"/>
  <path d="${line("totalCents")}" fill="none" stroke="#0f172a" stroke-width="2.5"/>
  <circle cx="${x(best.capacityPct).toFixed(1)}" cy="${y(best.totalCents).toFixed(1)}" r="5" fill="#0f172a"/>
  <text x="${(x(best.capacityPct) + 8).toFixed(1)}" y="${(y(best.totalCents) - 8).toFixed(1)}" fill="#0f172a" font-weight="600">min ${formatUsd(best.totalCents)} at ${best.capacityPct}%</text>
  <g transform="translate(${W - m.r - 220} ${m.t + 6})">
    <rect width="216" height="62" rx="6" fill="#ffffff" stroke="#e2e8f0"/>
    <line x1="10" x2="34" y1="16" y2="16" stroke="#0f172a" stroke-width="2.5"/><text x="42" y="20" fill="#0f172a">Total cost</text>
    <line x1="10" x2="34" y1="32" y2="32" stroke="#f97316" stroke-width="2" stroke-dasharray="6 4"/><text x="42" y="36" fill="#0f172a">Expected loss not reviewed (Σ p·L)</text>
    <line x1="10" x2="34" y1="48" y2="48" stroke="#2563eb" stroke-width="2" stroke-dasharray="2 4"/><text x="42" y="52" fill="#0f172a">Review cost (reviewed × c)</text>
  </g>
</svg>
`;
}

function niceStep(raw: number): number {
  const pow = 10 ** Math.floor(Math.log10(Math.max(raw, 1)));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}
