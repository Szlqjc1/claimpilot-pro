"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type ErrorBody = { error?: { code: string; message: string; requestId: string } };

export function AuditButton({ claimId, status }: { claimId: string; status: string }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const keyRef = useRef<string | null>(null);
  const busy = running;
  const done = status !== "Pending" || completed;

  const run = async () => {
    if (busy || done) return;
    setRunning(true);
    setMessage(null);
    // One key per click so a network retry of the same click is idempotent server-side.
    keyRef.current = `ui-${claimId}-${crypto.randomUUID()}`;
    try {
      const res = await fetch(`/api/claims/${claimId}/audit`, { method: "POST", headers: { "Idempotency-Key": keyRef.current } });
      const body = (await res.json()) as ErrorBody & { claim?: { riskLevel: string; decision: string; riskScore: number } };
      if (!res.ok || !body.claim) {
        const text = body.error ? `${body.error.message} (request ${body.error.requestId})` : `Audit failed (${res.status})`;
        setMessage({ tone: "error", text });
        toast.error("AI-RPA audit failed", { description: text });
        if (res.status === 409) router.refresh();
        return;
      }
      const text = `Audit complete: ${body.claim.riskLevel} risk · ${body.claim.riskScore}/100 · ${body.claim.decision}`;
      setMessage({ tone: "ok", text });
      setCompleted(true);
      toast.success("AI-RPA audit complete", { description: text });
      router.refresh();
    } catch {
      const text = "Network error — the claim was not changed. Try again.";
      setMessage({ tone: "error", text });
      toast.error("AI-RPA audit failed", { description: text });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <Button
        size="lg"
        variant={done ? "success" : "primary"}
        onClick={run}
        disabled={busy || done}
        aria-busy={busy}
        aria-describedby="audit-help"
        className="min-w-64"
      >
        {busy ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Running AI-RPA audit…
          </>
        ) : done ? (
          "✅ Audit complete"
        ) : (
          "🚀 Run AI-RPA Audit"
        )}
      </Button>
      <p aria-live="polite" role="status" className={message?.tone === "error" ? "text-[13px] text-danger" : "text-[13px] text-success"}>
        {message?.text}
      </p>
    </div>
  );
}
