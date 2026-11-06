import { forwardRef } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-info disabled:pointer-events-none disabled:opacity-60",
  {
    variants: {
      variant: {
        primary: "bg-accent-strong text-white hover:bg-orange-800 shadow-sm", // white on #c2410c = 5.18:1 (docs/ACCESSIBILITY.md)
        secondary: "border border-line bg-white text-ink hover:bg-slate-50",
        ghost: "text-ink hover:bg-slate-100",
        navy: "bg-navy-950 text-white hover:bg-navy-900",
        success: "bg-success text-white",
      },
      size: { sm: "h-8 px-3 text-[13px]", md: "h-9 px-4 text-sm", lg: "h-12 px-6 text-base", icon: "h-8 w-8" },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, ...props }, ref) => (
  <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
));
Button.displayName = "Button";
