import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function Pagination({ basePath, params, page, pageCount, total, pageSize }: { basePath: string; params: Record<string, string | undefined>; page: number; pageCount: number; total: number; pageSize: number }) {
  const href = (p: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v && k !== "page") sp.set(k, v);
    if (p > 1) sp.set("page", String(p));
    const s = sp.toString();
    return `${basePath}${s ? `?${s}` : ""}`;
  };
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const link = (p: number, disabled: boolean, label: string, icon: React.ReactNode) =>
    disabled ? (
      <span aria-disabled className="grid h-8 w-8 place-items-center rounded-lg border border-line text-slate-300">
        {icon}
        <span className="sr-only">{label}</span>
      </span>
    ) : (
      <Link href={href(p)} scroll={false} className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-white hover:bg-slate-50">
        {icon}
        <span className="sr-only">{label}</span>
      </Link>
    );
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 text-[13px] text-muted">
      <span className="tabular">
        {from}–{to} of {total}
      </span>
      <div className="flex items-center gap-2">
        {link(page - 1, page <= 1, "Previous page", <ChevronLeft className="h-4 w-4" aria-hidden />)}
        <span className={cn("tabular px-1")}>
          Page {page} / {pageCount}
        </span>
        {link(page + 1, page >= pageCount, "Next page", <ChevronRight className="h-4 w-4" aria-hidden />)}
      </div>
    </nav>
  );
}
