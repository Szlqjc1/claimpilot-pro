"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/input";
import { DISPOSITIONS, DISPOSITION_MEANING, type Disposition } from "@/lib/domain/constants";

const VERB: Record<Disposition, string> = { Resolved: "Resolve", Waived: "Waive", Dismissed: "Dismiss" };
const TITLE: Record<Disposition, string> = { Resolved: "Resolve exception", Waived: "Waive exception", Dismissed: "Not an exception" };
type ErrorBody = { error?: { code: string; message: string; requestId: string } };

const MIN = 10;
const MAX = 500;

export function ExceptionActions({ claimId, exceptionId, anomalyType, message }: { claimId: string; exceptionId: string; anomalyType: string; message: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<Disposition | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Focus management (docs/ACCESSIBILITY.md): return focus to the button that opened the dialog; after a successful
  // disposition that button is gone, so move focus to the Exceptions heading instead.
  const trigger = useRef<HTMLButtonElement | null>(null);
  const handled = useRef(false);
  const open = (d: Disposition, el: HTMLButtonElement) => {
    trigger.current = el;
    setMode(d);
  };
  const length = note.trim().length;
  const valid = length >= MIN && length <= MAX;

  const submit = async () => {
    if (!mode || !valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/claims/${claimId}/exceptions/${exceptionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: mode, note: note.trim() }),
      });
      const body = (await res.json()) as ErrorBody;
      if (!res.ok) {
        const text = body.error ? `${body.error.message} (request ${body.error.requestId})` : `Update failed (${res.status})`;
        setError(text);
        toast.error("Exception not updated", { description: text });
        if (res.status === 409) router.refresh();
        return;
      }
      handled.current = true;
      toast.success(mode === "Dismissed" ? `${anomalyType} dismissed as not an exception` : `${anomalyType} ${mode.toLowerCase()}`);
      setMode(null);
      setNote("");
      router.refresh();
    } catch {
      setError("Network error — the exception was not changed. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="flex gap-1.5">
        <Button size="sm" variant="secondary" onClick={(e) => open("Resolved", e.currentTarget)}>
          Resolve<span className="sr-only"> {anomalyType}</span>
        </Button>
        <Button size="sm" variant="ghost" onClick={(e) => open("Waived", e.currentTarget)}>
          Waive<span className="sr-only"> {anomalyType}</span>
        </Button>
        <Button size="sm" variant="ghost" className="text-muted" onClick={(e) => open("Dismissed", e.currentTarget)}>
          Not an exception<span className="sr-only"> ({anomalyType})</span>
        </Button>
      </div>
      <Dialog.Root open={mode !== null} onOpenChange={(o) => !o && !busy && (setMode(null), setError(null))}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <Dialog.Content
            className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-32px)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl bg-white p-5 shadow-xl"
            onCloseAutoFocus={(e) => {
              e.preventDefault();
              const target = handled.current ? document.getElementById("exceptions-heading") : trigger.current;
              handled.current = false;
              target?.focus();
            }}
          >
            <Dialog.Title className="text-base font-semibold">
              {mode ? TITLE[mode] : ""}: {anomalyType}
            </Dialog.Title>
            <Dialog.Description className="mt-1 text-[13px] text-muted">{message}</Dialog.Description>
            <ul className="mt-3 space-y-1 rounded-lg border border-line bg-slate-50 p-3 text-xs" aria-label="What each choice records">
              {DISPOSITIONS.map((d) => (
                <li key={d} className={d === mode ? "font-semibold text-ink" : "text-muted"}>
                  <span className="inline-block w-28">{TITLE[d]}</span> {DISPOSITION_MEANING[d]}
                </li>
              ))}
            </ul>
            <form
              className="mt-4"
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <Label htmlFor={`note-${exceptionId}`}>{mode === "Dismissed" ? "Why is this not an exception?" : "Resolution note"}</Label>
              <textarea
                id={`note-${exceptionId}`}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                required
                minLength={MIN}
                maxLength={MAX}
                rows={4}
                aria-describedby={`note-count-${exceptionId}`}
                placeholder={mode === "Dismissed" ? "What you checked and why the rule was wrong here (e.g. the invoice number on the scan matches)." : "What was checked, and the supporting document or approval reference."}
                className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-info"
              />
              <p id={`note-count-${exceptionId}`} aria-live="polite" className={`mt-1 text-xs tabular ${valid || length === 0 ? "text-muted" : "text-danger"}`}>
                {length}/{MAX} characters{length < MIN ? ` · at least ${MIN} required` : ""}
              </p>
              {error && (
                <p role="alert" className="mt-2 text-[13px] text-danger">
                  {error}
                </p>
              )}
              <div className="mt-4 flex justify-end gap-2">
                <Dialog.Close asChild>
                  <Button type="button" variant="secondary" disabled={busy}>
                    Cancel
                  </Button>
                </Dialog.Close>
                <Button type="submit" variant="primary" disabled={!valid || busy} aria-busy={busy}>
                  {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                  {mode ? (mode === "Dismissed" ? "Dismiss as not an exception" : `${VERB[mode]} exception`) : ""}
                </Button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
