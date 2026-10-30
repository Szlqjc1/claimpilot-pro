import { Braces, FileWarning } from "lucide-react";
import type { Extraction } from "@/lib/domain/schemas";
import { CONFIDENCE_COLORS, FIELD_LABELS, confidenceBand, fieldValue } from "@/lib/domain/fields";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const usd = (n: number | null) => (n === null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n));

function ConfidenceChip({ field, value }: { field: string; value: number | undefined }) {
  if (value === undefined) return null;
  const band = confidenceBand(value);
  const c = CONFIDENCE_COLORS[band];
  return (
    <span className="tabular inline-flex items-center gap-1 rounded-full border px-1.5 text-[11px]" style={{ borderColor: c.stroke, color: c.text, background: c.fill }} title={`${FIELD_LABELS[field] ?? field} OCR confidence`}>
      <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: c.stroke }} />
      {value.toFixed(2)}
      <span className="sr-only"> confidence ({band})</span>
    </span>
  );
}

/** "AI Structured Data" — connected to Extracted_Data. Rendered only for Status === "Analyzed". */
export function AiStructuredData({ result, raw }: { result: { ok: true; data: Extraction } | { ok: false; error: string } | null; raw: string | null }) {
  return (
    <Card data-testid="ai-structured-data">
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <Braces className="h-4 w-4 text-info" aria-hidden /> AI Structured Data
          </CardTitle>
          <CardDescription>Extracted_Data · OCR + LLM extraction, validated by schema</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {!result || !result.ok ? (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-[13px] text-danger">
            <FileWarning className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <div>
              <p className="font-medium">Extracted_Data could not be parsed.</p>
              <p className="mt-0.5 break-all">{result ? result.error : "No data stored."}</p>
            </div>
          </div>
        ) : (
          <ExtractionBody e={result.data} raw={raw} />
        )}
      </CardContent>
    </Card>
  );
}

function ExtractionBody({ e, raw }: { e: Extraction; raw: string | null }) {
  const summary: [string, string, string | null][] = [
    ["Vendor", e.vendor.name ?? "—", "vendorName"],
    ["Invoice #", e.invoiceNumber ?? "—", "invoiceNumber"],
    ["Invoice date", e.invoiceDate ?? "—", "invoiceDate"],
    ["PO", e.poNumber ?? "—", "poNumber"],
    ["GRN / gate pass", fieldValue(e, "grnNumber"), "grnNumber"],
    ["Project ref.", e.projectCode ?? "—", "projectCode"],
    ["Subtotal", usd(e.subtotal), "subtotal"],
    ["Sales tax", `${usd(e.salesTax)}${e.taxRate ? ` (${(e.taxRate * 100).toFixed(2)}%)` : ""}`, "salesTax"],
    ["Freight / other", `${usd(e.freight)} / ${usd(e.otherCharges)}`, null],
    ["Total", usd(e.total), "total"],
    ["Payment terms", e.paymentTerms ?? "—", null],
    ["Approval", e.approval ? `${e.approval.name} · ${e.approval.level}` : "None", null],
  ];
  let pretty = raw ?? "";
  try {
    pretty = JSON.stringify(JSON.parse(raw ?? "null"), null, 2);
  } catch {
    /* raw shown as stored */
  }
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-1 gap-x-5 gap-y-3 sm:grid-cols-2">
        {summary.map(([label, value, field]) => (
          <div key={label} className="min-w-0">
            <dt className="flex items-center gap-1.5 text-xs text-muted">
              {label} {field && <ConfidenceChip field={field} value={e.fieldConfidence[field]} />}
            </dt>
            <dd className={`truncate font-medium ${label === "Total" ? "tabular text-[15px]" : "text-[13px]"} ${/[#.]|PO|GRN|Project/.test(label) ? "font-mono" : ""}`} title={value}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
      {e.attendees && (
        <p className="text-[13px]">
          <span className="text-muted">Attendees:</span> {e.attendees.count ?? "?"} · {e.attendees.names.length ? e.attendees.names.join(", ") : <span className="text-warning">list not provided</span>}
        </p>
      )}
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full text-[12px]">
          <caption className="sr-only">Extracted line items</caption>
          <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-muted">
            <tr>
              <th scope="col" className="px-3 py-2">#</th>
              <th scope="col" className="px-3 py-2">Part / description</th>
              <th scope="col" className="px-3 py-2 text-right">Qty</th>
              <th scope="col" className="px-3 py-2 text-right">Unit price</th>
              <th scope="col" className="px-3 py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {e.lineItems.map((li) => (
              <tr key={li.line}>
                <td className="px-3 py-2 text-muted">{li.line}</td>
                <td className="px-3 py-2">
                  <span className="font-mono text-[11px] text-muted">{li.partNumber ?? "—"}</span>
                  <span className="block">{li.description}</span>
                </td>
                <td className="tabular px-3 py-2 text-right whitespace-nowrap">
                  {li.quantity.toLocaleString("en-US")} {li.unit}
                </td>
                <td className="tabular px-3 py-2 text-right">{usd(li.unitPrice)}</td>
                <td className="tabular px-3 py-2 text-right font-medium">{usd(li.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {e.warnings.length > 0 && (
        <ul className="space-y-1">
          {e.warnings.map((w) => (
            <li key={w}>
              <Badge tone="amber">Warning</Badge> <span className="text-[13px]">{w}</span>
            </li>
          ))}
        </ul>
      )}
      <details className="group rounded-lg border border-line">
        <summary className="cursor-pointer px-3 py-2 text-[13px] font-medium text-info">View raw JSON</summary>
        <pre className="max-h-80 overflow-auto border-t border-line bg-slate-950 p-3 text-[11px] leading-relaxed text-slate-100">{pretty}</pre>
      </details>
    </div>
  );
}
