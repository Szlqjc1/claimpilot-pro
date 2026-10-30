"use client";

import { useState } from "react";
import { Download, ExternalLink, Maximize, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ReceiptViewer({ src, mime, alt, meta }: { src: string; mime: string; alt: string; meta: { label: string; value: string }[] }) {
  const [zoom, setZoom] = useState(1);
  const isPdf = mime === "application/pdf";
  return (
    <div className="flex flex-col">
      <div role="toolbar" aria-label="Receipt viewer controls" className="flex items-center gap-1 border-b border-line px-3 py-2">
        <Button size="icon" variant="ghost" aria-label="Zoom out" disabled={isPdf || zoom <= 0.5} onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))}>
          <ZoomOut className="h-4 w-4" aria-hidden />
        </Button>
        <span className="tabular w-12 text-center text-xs text-muted" aria-live="polite">
          {Math.round(zoom * 100)}%
        </span>
        <Button size="icon" variant="ghost" aria-label="Zoom in" disabled={isPdf || zoom >= 3} onClick={() => setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)))}>
          <ZoomIn className="h-4 w-4" aria-hidden />
        </Button>
        <Button size="icon" variant="ghost" aria-label="Fit to width" disabled={isPdf} onClick={() => setZoom(1)}>
          <Maximize className="h-4 w-4" aria-hidden />
        </Button>
        <div className="flex-1" />
        <a href={src} target="_blank" rel="noopener" className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[13px] text-ink hover:bg-slate-100">
          <ExternalLink className="h-4 w-4" aria-hidden /> Open
        </a>
        <a href={`${src}?download=1`} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[13px] text-ink hover:bg-slate-100">
          <Download className="h-4 w-4" aria-hidden /> Download
        </a>
      </div>
      <div className="max-h-[820px] overflow-auto bg-slate-100 p-3">
        {isPdf ? (
          <iframe src={src} title={alt} className="h-[780px] w-full rounded bg-white" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- receipts are streamed from an authenticated API route
          <img src={src} alt={alt} style={{ width: `${zoom * 100}%` }} className="mx-auto block max-w-none rounded bg-white shadow-sm" />
        )}
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-line px-4 py-3 text-xs sm:grid-cols-4">
        {meta.map((m) => (
          <div key={m.label} className="min-w-0">
            <dt className="text-muted">{m.label}</dt>
            <dd className="truncate font-mono text-[12px] text-ink" title={m.value}>
              {m.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
