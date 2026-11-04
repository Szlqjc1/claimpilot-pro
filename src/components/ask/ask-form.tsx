"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, MessageSquareText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type Answer = { answer: string; citations: string[]; source: "model" | "template" };

export const EXAMPLES = ["Why was CLM-2026-0144 flagged?", "How much did we spend with Lone Star Robotics?", "What should I review first?"] as const;

export function AskForm() {
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<Answer | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function ask(q: string) {
    const text = q.trim();
    if (text.length < 5) {
      setError("Ask a question of at least 5 characters.");
      return;
    }
    setQuestion(text);
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: text }) });
      const body = (await res.json().catch(() => null)) as (Answer & { error?: { message: string } }) | null;
      if (!res.ok || !body || body.error) {
        setResult(null);
        setError(body?.error?.message ?? `Request failed (${res.status})`);
      } else setResult(body);
    } catch {
      setError("Network error; try again.");
    } finally {
      setPending(false);
    }
  }

  const rules = result?.citations.filter((c) => c.startsWith("R-")) ?? [];
  const claims = result?.citations.filter((c) => c.startsWith("CLM-")) ?? [];

  return (
    <div className="flex flex-col gap-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void ask(question);
        }}
        className="flex flex-col gap-3"
      >
        <label htmlFor="ask-question" className="text-[13px] font-medium">
          Question
        </label>
        <textarea
          id="ask-question"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={300}
          rows={3}
          placeholder="e.g. Why was CLM-2026-0144 flagged?"
          className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink placeholder:text-slate-400 focus-visible:outline-2 focus-visible:outline-info"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void ask(question);
            }
          }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="primary" disabled={pending} aria-describedby="ask-help">
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <MessageSquareText className="h-4 w-4" aria-hidden />}
            {pending ? "Answering…" : "Ask"}
          </Button>
          <span id="ask-help" className="text-xs text-muted">
            Answers use only facts retrieved from the database. Every question is recorded in the audit log.
          </span>
        </div>
        <div className="flex flex-wrap gap-2" aria-label="Example questions">
          {EXAMPLES.map((q) => (
            <button
              key={q}
              type="button"
              disabled={pending}
              onClick={() => void ask(q)}
              className="rounded-full border border-line bg-white px-3 py-1 text-[13px] text-ink hover:bg-slate-50 disabled:opacity-60"
            >
              {q}
            </button>
          ))}
        </div>
      </form>

      <div aria-live="polite">
        {error && (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-[13px] text-danger">
            {error}
          </p>
        )}
        {result && (
          <section aria-label="Answer" className="rounded-xl border border-line bg-white p-4" data-testid="ask-answer">
            <div className="mb-2 flex items-center gap-2">
              <h2 className="text-sm font-semibold">Answer</h2>
              <Badge tone={result.source === "model" ? "blue" : "neutral"} title={result.source === "model" ? "Phrased by the model from retrieved facts; ids and amounts verified" : "Deterministic template built from retrieved facts"}>
                {result.source === "model" ? "Model" : "Template"}
              </Badge>
            </div>
            <p className="text-[14px] leading-relaxed">{result.answer}</p>
            {(claims.length > 0 || rules.length > 0) && (
              <p className="mt-3 flex flex-wrap items-center gap-2 text-[13px]">
                <span className="text-xs font-medium text-muted">Sources</span>
                {claims.map((id) => (
                  <Link key={id} href={`/claims/${id}`} className="font-mono text-xs text-info hover:underline">
                    {id}
                  </Link>
                ))}
                {rules.map((id) => (
                  <span key={id} className="font-mono text-xs text-muted">
                    {id}
                  </span>
                ))}
              </p>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
