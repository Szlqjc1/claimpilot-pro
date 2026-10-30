import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { aiStatus } from "@/lib/ai/provider";
import { PageHeader } from "@/components/shell/page-header";
import { NewClaimForm } from "@/components/claims/new-claim-form";

export const metadata: Metadata = { title: "New Claim" };

export default async function NewClaimPage() {
  const [employees, projects, vendors] = await Promise.all([
    prisma.employee.findMany({ where: { department: { not: "Corporate Audit" } }, orderBy: { name: "asc" } }),
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
      <NewClaimForm employees={employees.map((e) => ({ name: e.name, department: e.department }))} projects={projects} vendors={vendors.map((v) => v.name)} />
    </>
  );
}
