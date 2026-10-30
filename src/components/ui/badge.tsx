import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const badgeVariants = cva("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap", {
  variants: {
    tone: {
      neutral: "border-slate-200 bg-slate-50 text-slate-700",
      amber: "border-amber-200 bg-amber-50 text-warning",
      blue: "border-blue-200 bg-blue-50 text-info",
      green: "border-emerald-200 bg-emerald-50 text-success",
      red: "border-red-200 bg-red-50 text-danger",
      orange: "border-orange-200 bg-orange-50 text-accent-strong",
      navy: "border-navy-800 bg-navy-900 text-white",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export function Badge({ className, tone, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
