"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, FileStack, ScrollText, BookOpenCheck, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

export const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/claims", label: "Claims", icon: FileStack },
  { href: "/audit", label: "Audit Log", icon: ScrollText },
  { href: "/policies", label: "Policies & Data", icon: BookOpenCheck },
] as const;

export function Brand() {
  return (
    <Link href="/dashboard" className="flex items-center gap-2.5 px-5 py-5 text-white">
      <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent">
        <ShieldCheck className="h-5 w-5" aria-hidden />
      </span>
      <span className="leading-tight">
        <span className="block text-[15px] font-semibold tracking-tight">ClaimPilot PRO</span>
        <span className="block text-[11px] text-slate-300">AI-RPA expense review</span>
      </span>
    </Link>
  );
}

export function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-col gap-1 px-3">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              active ? "bg-navy-800 text-white" : "text-slate-300 hover:bg-navy-900 hover:text-white",
            )}
          >
            {active && <span aria-hidden className="absolute inset-y-1.5 left-0 w-[3px] rounded-r bg-accent" />}
            <Icon className="h-4 w-4" aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

export function SidebarFooter() {
  return <p className="px-5 py-4 text-[11px] leading-relaxed text-slate-400">Demo environment · Ironwood Safety Systems</p>;
}
