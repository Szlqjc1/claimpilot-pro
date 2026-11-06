import { cn } from "@/lib/utils";

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="relative w-full overflow-x-auto">
      <table className={cn("w-full border-collapse text-[13px]", className)} {...props} />
    </div>
  );
}
export const THead = (p: React.HTMLAttributes<HTMLTableSectionElement>) => <thead {...p} className={cn("bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-muted", p.className)} />;
export const TBody = (p: React.HTMLAttributes<HTMLTableSectionElement>) => <tbody {...p} className={cn("divide-y divide-line", p.className)} />;
export const TR = (p: React.HTMLAttributes<HTMLTableRowElement>) => <tr {...p} />;
export const TH = (p: React.ThHTMLAttributes<HTMLTableCellElement>) => <th scope="col" {...p} className={cn("whitespace-nowrap px-4 py-2.5 font-semibold", p.className)} />;
export const TD = (p: React.TdHTMLAttributes<HTMLTableCellElement>) => <td {...p} className={cn("px-4 py-2.5 align-middle", p.className)} />;
