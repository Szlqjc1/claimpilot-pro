"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type ErrorBody = { error?: { code: string; message: string; requestId: string } };

export function PostToSapButton({ claimId, openExceptions, amountLabel }: { claimId: string; openExceptions: number; amountLabel: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Status line under the button: red for a failure, green for the confirmation shown until the page refreshes.
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const blocked = openExceptions > 0;

  const post = async () => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/claims/${claimId}/post`, { method: "POST" });
      const body = (await res.json()) as ErrorBody & { miroDocNo?: string };
      if (!res.ok || !body.miroDocNo) {
        const text = body.error ? `${body.error.message} (request ${body.error.requestId})` : `Posting failed (${res.status})`;
        setMessage({ text, ok: false });
        toast.error("Posting to SAP failed", { description: text });
        if (res.status === 409) router.refresh();
        return;
      }
      setOpen(false);
      setMessage({ text: `Posted to SAP · ${body.miroDocNo}`, ok: true });
      toast.success("Posted to SAP", { description: `${claimId} · ${body.miroDocNo}` });
      router.refresh();
    } catch {
      const text = "Network error — the claim was not posted. Try again.";
      setMessage({ text, ok: false });
      toast.error("Posting to SAP failed", { description: text });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <Dialog.Root open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <Dialog.Trigger asChild>
          <Button variant="navy" disabled={blocked || busy} aria-describedby="post-help" className="min-w-40">
            <Send className="h-4 w-4" aria-hidden /> Post to SAP
          </Button>
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-32px)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl bg-white p-5 shadow-xl">
            <Dialog.Title className="text-base font-semibold">Post {claimId} to SAP?</Dialog.Title>
            <Dialog.Description className="mt-1 text-[13px] text-muted">
              Creates a MIRO invoice document for {amountLabel} and releases it to the payment run. This is recorded in the audit log and cannot be undone here.
            </Dialog.Description>
            <div className="mt-5 flex justify-end gap-2">
              <Dialog.Close asChild>
                <Button variant="secondary" disabled={busy}>
                  Cancel
                </Button>
              </Dialog.Close>
              <Button variant="primary" onClick={post} disabled={busy} aria-busy={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
                {busy ? "Posting…" : "Confirm posting"}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <p aria-live="polite" role="status" className={`text-[13px] ${message?.ok ? "text-success" : "text-danger"}`}>
        {message?.text}
      </p>
    </div>
  );
}
