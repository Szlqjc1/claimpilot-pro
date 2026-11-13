import type { Metadata } from "next";
import Image from "next/image";
import mark from "@/assets/claimpilot-mark.png";
import { DEMO_ACCOUNTS } from "@/lib/auth/demo-accounts";
import { ROLE_LABELS, safeNextPath } from "@/lib/auth/constants";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = (await searchParams).next;
  const next = safeNextPath(Array.isArray(raw) ? raw[0] : raw);
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4 py-10">
      <div className="grid w-full max-w-4xl grid-cols-1 overflow-hidden rounded-2xl border border-line bg-white shadow-sm md:grid-cols-[1fr_1fr]">
        <section className="flex flex-col justify-between gap-8 bg-navy-950 p-8 text-white">
          <div className="flex items-center gap-2.5">
            <Image src={mark} alt="" width={36} height={36} className="h-9 w-9 shrink-0" priority />
            <span className="leading-tight">
              <span className="block text-[15px] font-semibold tracking-tight">ClaimPilot PRO</span>
              <span className="block text-[11px] text-slate-300">AI-RPA expense review</span>
            </span>
          </div>
          <div>
            <h2 className="text-lg font-semibold">Demo accounts</h2>
            <p className="mt-1 text-[13px] text-slate-300">Demo accounts only — not real Joyson employees.</p>
            <ul className="mt-4 space-y-3">
              {DEMO_ACCOUNTS.map((a) => (
                <li key={a.email} className="rounded-lg bg-navy-900 p-3 text-[13px]">
                  <p className="font-medium">
                    {a.name} <span className="font-normal text-slate-300">· {ROLE_LABELS[a.role]} · {a.title}</span>
                  </p>
                  <p className="mt-1 font-mono text-[12px] text-slate-200">{a.email}</p>
                  <p className="font-mono text-[12px] text-slate-200">{a.password}</p>
                </li>
              ))}
            </ul>
          </div>
          <p className="text-[11px] text-slate-400">Demo environment · Joyson Safety Systems</p>
        </section>
        <section className="p-8">
          <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
          <p className="mt-1 text-sm text-muted">Use your Joyson Safety Systems account to review supplier invoices.</p>
          <LoginForm next={next} />
        </section>
      </div>
    </main>
  );
}
