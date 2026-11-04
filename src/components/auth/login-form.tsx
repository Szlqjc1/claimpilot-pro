"use client";

import { useState } from "react";
import { Loader2, LogIn } from "lucide-react";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type ErrorBody = { error?: { code: string; message: string; requestId: string } };

export function LoginForm({ next }: { next: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="mt-6 space-y-4"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        setBusy(true);
        setError(null);
        try {
          const res = await fetch("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
          });
          if (!res.ok) {
            const body = (await res.json()) as ErrorBody;
            setError(body.error?.message ?? `Sign-in failed (${res.status}).`);
            setBusy(false);
            return;
          }
          // Full navigation so the server layout reads the new session cookie.
          window.location.assign(next);
        } catch {
          setError("Network error. Try again.");
          setBusy(false);
        }
      }}
    >
      <div>
        <Label htmlFor="login-email">Email</Label>
        <Input id="login-email" name="email" type="email" autoComplete="username" required autoFocus aria-describedby="login-error" />
      </div>
      <div>
        <Label htmlFor="login-password">Password</Label>
        <Input id="login-password" name="password" type="password" autoComplete="current-password" required aria-describedby="login-error" />
      </div>
      <p id="login-error" aria-live="polite" role="status" className="min-h-5 text-[13px] text-danger">
        {error}
      </p>
      <Button type="submit" variant="primary" className="w-full" disabled={busy} aria-busy={busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <LogIn className="h-4 w-4" aria-hidden />}
        {busy ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
