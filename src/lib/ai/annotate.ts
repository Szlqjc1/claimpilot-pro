import type { Extraction } from "@/lib/domain/schemas";
import { CONFIDENCE_COLORS, FIELD_LABELS, confidenceBand, fieldValue } from "@/lib/domain/fields";

const W = 1200;
const H = 1600;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
const trunc = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Build the AI-annotated invoice as a standalone SVG (renders inside <img>).
 * The original is embedded as a data URI because SVG-as-image cannot fetch external resources.
 * Boxes are drawn only when the OCR layer supplied geometry; otherwise a "Fields extracted" panel is shown.
 */
export function annotateReceipt(original: { data: Buffer; mime: string }, extraction: Extraction): string {
  const dataUri = `data:${original.mime};base64,${original.data.toString("base64")}`;
  const parts: string[] = [`<rect width="${W}" height="${H}" fill="#ffffff"/>`];
  const boxes = extraction.boundingBoxes.filter((b) => FIELD_LABELS[b.field]);

  if (boxes.length > 0) {
    parts.push(`<image href="${dataUri}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid meet"/>`);
    for (const b of boxes) {
      const conf = extraction.fieldConfidence[b.field];
      const c = CONFIDENCE_COLORS[confidenceBand(conf)];
      const x = b.x * W;
      const y = b.y * H;
      const w = b.w * W;
      const h = b.h * H;
      const label = `${FIELD_LABELS[b.field]}: ${trunc(fieldValue(extraction, b.field), 28)}${conf !== undefined ? ` · ${conf.toFixed(2)}` : ""}`;
      const lw = label.length * 7.4 + 14;
      // Place the tag above the box, or below if it would leave the page; keep it on-canvas horizontally.
      const ly = y - 24 < 40 ? y + h + 2 : y - 24;
      const lx = Math.min(Math.max(4, x), W - lw - 4);
      parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="${c.stroke}" fill-opacity="0.08" stroke="${c.stroke}" stroke-width="2.5"/>`);
      parts.push(`<rect x="${lx}" y="${ly}" width="${lw}" height="22" rx="4" fill="${c.stroke}"/>`);
      parts.push(`<text x="${lx + 7}" y="${ly + 15.5}" font-size="12.5" font-family="Helvetica, Arial, sans-serif" font-weight="700" fill="#ffffff">${esc(label)}</text>`);
    }
  } else {
    parts.push(`<image href="${dataUri}" x="24" y="60" width="700" height="1400" preserveAspectRatio="xMidYMin meet"/>`);
    parts.push(`<rect x="748" y="60" width="428" height="1400" rx="10" fill="#f8fafc" stroke="#e4e7ec"/>`);
    parts.push(`<text x="772" y="100" font-size="20" font-weight="700" font-family="Helvetica, Arial, sans-serif" fill="#0a1b2e">Fields extracted</text>`);
    parts.push(`<text x="772" y="124" font-size="13" font-family="Helvetica, Arial, sans-serif" fill="#667085">No bounding boxes available for this upload.</text>`);
    Object.keys(FIELD_LABELS).forEach((field, i) => {
      const conf = extraction.fieldConfidence[field];
      const c = CONFIDENCE_COLORS[confidenceBand(conf)];
      const y = 170 + i * 64;
      parts.push(`<rect x="772" y="${y - 26}" width="380" height="52" rx="6" fill="${c.fill}" stroke="${c.stroke}"/>`);
      parts.push(`<text x="786" y="${y - 6}" font-size="12" font-family="Helvetica, Arial, sans-serif" fill="${c.text}">${esc(FIELD_LABELS[field])}${conf !== undefined ? ` · ${conf.toFixed(2)}` : ""}</text>`);
      parts.push(`<text x="786" y="${y + 15}" font-size="16" font-weight="700" font-family="Menlo, Consolas, monospace" fill="#101828">${esc(trunc(fieldValue(extraction, field), 34))}</text>`);
    });
  }

  // Legend + footer
  const lx = 812;
  const ly = 1496;
  parts.push(`<rect x="${lx}" y="${ly}" width="372" height="96" rx="8" fill="#ffffff" fill-opacity="0.96" stroke="#d0d5dd"/>`);
  parts.push(`<text x="${lx + 14}" y="${ly + 22}" font-size="13" font-weight="700" font-family="Helvetica, Arial, sans-serif" fill="#101828">OCR confidence</text>`);
  (["high", "medium", "low"] as const).forEach((band, i) => {
    const c = CONFIDENCE_COLORS[band];
    const x = lx + 14 + i * 118;
    parts.push(`<rect x="${x}" y="${ly + 34}" width="16" height="16" rx="3" fill="${c.stroke}"/>`);
    parts.push(`<text x="${x + 22}" y="${ly + 47}" font-size="12.5" font-family="Helvetica, Arial, sans-serif" fill="#344054">${esc(c.label)}</text>`);
  });
  parts.push(`<text x="${lx + 14}" y="${ly + 80}" font-size="12.5" font-family="Helvetica, Arial, sans-serif" fill="#667085">AI-generated overlay — demo data</text>`);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="AI-annotated invoice">${parts.join("")}</svg>`;
}
