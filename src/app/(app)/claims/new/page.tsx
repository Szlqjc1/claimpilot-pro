import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { aiStatus } from "@/lib/ai/provider";
import { PageHeader } from "@/components/shell/page-header";
import { NewClaimForm } from "@/components/claims/new-claim-form";
import { requireUser } from "@/lib/auth/session";
import { resolveClaimant } from "@/lib/auth/claimant";

export const metadata: Metadata = { title: "New Claim" };

export default async function NewClaimPage() {
  const user = await requireUser();
  const [claimant, projects, vendors] = await Promise.all([
    resolveClaimant(user.name),
    prisma.project.findMany({ orderBy: { code: "asc" }, select: { code: true, name: true } }),
    prisma.vendor.findMany({ orderBy: { name: "asc" }, select: { name: true } }),
  ]);
  const ai = aiStatus();
  return (
    <>
      <PageHeader eyebrow="Intake" title="New Claim" subtitle="Upload a supplier invoice (PNG, JPEG or PDF, max 10 MB). The claim is created as Pending." />
      {ai.mode === "mock" && (
        <p role="note" className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-[13px] text-info">
          Live OCR is disabled in demo mode. Seeded claims use deterministic fixtures. Uploaded claims can be stored and reviewed, but the AI-RPA audit needs AI_MODE=live with OCR_MODE=tesseract.
        </p>
      )}
      {claimant.ok ? (
        <NewClaimForm claimant={{ name: claimant.employee, department: claimant.department }} projects={projects} vendors={vendors.map((v) => v.name)} />
      ) : (
        <p role="alert" className="max-w-3xl rounded-lg border border-amber-200 bg-amber-50 p-3 text-[13px] text-warning">
          {claimant.reason} Sign in as a requester (for example Marcus Reed) to submit a claim.
        </p>
      )}
    </>
  );
}
