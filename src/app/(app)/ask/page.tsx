import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { aiStatus } from "@/lib/ai/provider";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { AskForm } from "@/components/ask/ask-form";

export const metadata: Metadata = { title: "Ask" };
export const dynamic = "force-dynamic";

export default async function AskPage() {
  await requireUser();
  const ai = aiStatus();
  return (
    <>
      <PageHeader
        eyebrow="GROUNDED Q&A"
        title="Ask"
        subtitle={`Questions about claim status, vendor spend, policy limits and current priorities, answered from the database only. ${
          ai.mode === "mock" ? "Demo AI: answers come from deterministic templates." : "DeepSeek may phrase the answer; every id and amount is checked against the retrieved facts."
        }`}
      />
      <Card className="max-w-3xl">
        <CardContent className="py-5">
          <AskForm />
        </CardContent>
      </Card>
    </>
  );
}
