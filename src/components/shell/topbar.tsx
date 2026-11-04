"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Search, Cpu, LogOut } from "lucide-react";
import type { AiStatus } from "@/lib/ai/provider";
import { ROLE_LABELS } from "@/lib/auth/constants";
import { Badge } from "@/components/ui/badge";
import { MobileNav } from "./mobile-nav";
import { NAV } from "./nav";

function crumbs(pathname: string) {
  const parts = pathname.split("/").filter(Boolean);
  const out: { href: string; label: string }[] = [];
  let acc = "";
  for (const p of parts) {
    acc += `/${p}`;
    const nav = NAV.find((n) => n.href === acc);
    out.push({ href: acc, label: nav?.label ?? (p === "new" ? "New Claim" : decodeURIComponent(p)) });
  }
  return out;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0]!.toUpperCase())
    .slice(0, 2)
    .join("");
}

export function Topbar({ ai, user }: { ai: AiStatus; user: { name: string; role: string } }) {
  const pathname = usePathname();
  const [signingOut, setSigningOut] = useState(false);
  const signOut = async () => {
    setSigningOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      // Full navigation so no cached authenticated view survives.
      window.location.assign("/login");
    }
  };
  const items = crumbs(pathname);
  const tone = ai.mode === "mock" ? "neutral" : ai.configured ? "green" : "red";
  return (
    <header className="no-print sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-white px-4 sm:px-6">
      <MobileNav />
      <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
        <ol className="flex items-center gap-1.5 truncate text-sm">
          {items.map((c, i) => (
            <li key={c.href} className="flex items-center gap-1.5 truncate">
              {i > 0 && (
                <span className="text-slate-300" aria-hidden>
                  /
                </span>
              )}
              {i === items.length - 1 ? (
                <span aria-current="page" className="truncate font-medium text-ink">
                  {c.label}
                </span>
              ) : (
                <Link href={c.href} className="truncate text-muted hover:text-ink">
                  {c.label}
                </Link>
              )}
            </li>
          ))}
        </ol>
      </nav>
      <form action="/claims" role="search" className="relative hidden md:block">
        <label htmlFor="global-search" className="sr-only">
          Search claims
        </label>
        <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" aria-hidden />
        <input id="global-search" name="q" placeholder="Claim ID, invoice, vendor…" className="h-9 w-64 rounded-lg border border-line bg-slate-50 pl-8 pr-3 text-sm focus:bg-white" />
      </form>
      <Badge tone={tone} title={`AI mode: ${ai.label} · OCR: ${ai.ocrMode}`}>
        <Cpu className="h-3 w-3" aria-hidden />
        <span className="sr-only">AI mode:</span> {ai.label}
      </Badge>
      <Badge tone="orange" className="hidden sm:inline-flex">
        Sample data
      </Badge>
      <div className="hidden items-center gap-2 border-l border-line pl-3 sm:flex">
        <span aria-hidden className="grid h-8 w-8 place-items-center rounded-full bg-navy-900 text-xs font-semibold text-white">
          {initials(user.name)}
        </span>
        <span className="text-[13px] leading-tight">
          <span className="block font-medium">{user.name}</span>
          <span className="block text-muted">{ROLE_LABELS[user.role] ?? user.role}</span>
        </span>
      </div>
      <button
        type="button"
        onClick={signOut}
        disabled={signingOut}
        aria-busy={signingOut}
        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[13px] font-medium text-ink hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-info disabled:opacity-60"
      >
        <LogOut className="h-4 w-4" aria-hidden />
        <span className="hidden sm:inline">Sign out</span>
        <span className="sr-only sm:hidden">Sign out</span>
      </button>
    </header>
  );
}
