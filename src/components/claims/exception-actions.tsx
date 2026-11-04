"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/input";

type Disposition = "Resolved" | "Waived";
type ErrorBody = { error?: { code: string; message: string; requestId: string } };

const MIN = 10;
const MAX = 500;

export function ExceptionActions({ claimId, exceptionId, anomalyType, message }: { claimId: string; exceptionId: string; anomalyType: string; message: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<Disposition | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
      toast.success(`${anomalyType} ${mode.toLowerCase()}`);
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
        <Button size="sm" variant="secondary" onClick={() => setMode("Resolved")}>
          Resolve<span className="sr-only"> {anomalyType}</span>
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setMode("Waived")}>
          Waive<span className="sr-only"> {anomalyType}</span>
        </Button>
      </div>
      <Dialog.Root open={mode !== null} onOpenChange={(o) => !o && !busy && (setMode(null), setError(null))}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-32px)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl bg-white p-5 shadow-xl">
            <Dialog.Title className="text-base font-semibold">
              {mode === "Waived" ? "Waive" : "Resolve"} exception: {anomalyType}
            </Dialog.Title>
            <Dialog.Description className="mt-1 text-[13px] text-muted">{message}</Dialog.Description>
            <form
              className="mt-4"
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <Label htmlFor={`note-${exceptionId}`}>Resolution note</Label>
              <textarea
                id={`note-${exceptionId}`}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                required
                minLength={MIN}
                maxLength={MAX}
                rows={4}
                aria-describedby={`note-count-${exceptionId}`}
                placeholder="What was checked, and the supporting document or approval reference."
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
                  {mode === "Waived" ? "Waive exception" : "Resolve exception"}
                </Button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
