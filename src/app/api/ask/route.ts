import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { aiConfig } from "@/lib/ai/provider";
import { retrieveFacts } from "@/lib/ask/retrieve";
import { answerQuestion } from "@/lib/ask/answer";
import { isSameOrigin, jsonError, newRequestId, rateLimit } from "@/lib/api";
import { requireUser } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ question: z.string().trim().min(5).max(300) });

/** Grounded Q&A (docs/AI_GOVERNANCE.md): retrieval first, deterministic template, optional model phrasing. */
export async function POST(req: Request) {
  const requestId = newRequestId();
  const user = await requireUser({ api: true });
  if (!user) return jsonError(401, "UNAUTHENTICATED", "Sign in to continue", requestId);
  if (!isSameOrigin(req)) return jsonError(403, "CROSS_ORIGIN", "Cross-origin requests are not allowed", requestId);
  const cfg = aiConfig();
  if (cfg.mode === "live" && !cfg.apiKey) return jsonError(503, "AI_NOT_CONFIGURED", "AI provider is not configured", requestId);
  if (!rateLimit("ask", 10)) return jsonError(429, "RATE_LIMITED", "Too many questions; try again in a minute", requestId);

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return jsonError(400, "INVALID_BODY", "Expected a JSON body", requestId);
  }
  const body = bodySchema.safeParse(raw);
  if (!body.success) return jsonError(400, "VALIDATION_FAILED", "Ask a question of 5 to 300 characters.", requestId);

  const { question } = body.data;
  try {
    const facts = await retrieveFacts(question, user);
    const result = await answerQuestion(question, facts, { requestId });
    // The only write: one audit row. The question text, never the answer or any retrieved data.
    await prisma.auditLog.create({
      data: {
        logId: randomUUID(),
        actor: user.name,
        action: "AI Answer",
        details: question,
        metadata: JSON.stringify({ requestId, kind: result.kind, source: result.source, citations: result.citations }),
      },
    });
    return NextResponse.json({ answer: result.answer, citations: result.citations, source: result.source }, { headers: { "x-request-id": requestId } });
  } catch (err) {
    console.error(JSON.stringify({ evt: "ask.error", requestId, error: err instanceof Error ? err.message : "unknown" }));
    return jsonError(500, "INTERNAL", "Could not answer that question", requestId);
  }
}
