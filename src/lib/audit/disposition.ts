import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { formatUsd, toCents } from "@/lib/domain/money";
import { AuditError } from "./run-audit";
import { miroDocNo } from "./miro";

// Human disposition (resolve / waive exceptions) and SAP posting. Every step is appended to the AuditLog.

export type PostResult = { claimId: string; status: "Posted"; postedAt: string; miroDocNo: string };

/** `actor` is the signed-in reviewer: attributed on the Exceptions Resolved row and recorded as `initiatedBy` on the SAP row. */
export async function postClaim(claimId: string, opts: { requestId: string; actor: string; revalidate?: (paths: string[]) => void }): Promise<PostResult> {
  const claim = await prisma.claim.findUnique({ where: { claimId }, include: { vendor: true, exceptions: true } });
  if (!claim) throw new AuditError(404, "CLAIM_NOT_FOUND", `Claim ${claimId} not found`);
  if (claim.status === "Posted") throw new AuditError(409, "CLAIM_ALREADY_POSTED", "Claim is already posted to SAP", { currentStatus: claim.status });
  if (claim.status !== "Analyzed") throw new AuditError(409, "CLAIM_NOT_ANALYZED", "Run the AI-RPA audit before posting", { currentStatus: claim.status });
  const open = claim.exceptions.filter((e) => e.status === "Open").length;
  if (open > 0) throw new AuditError(409, "EXCEPTIONS_OPEN", `${open} exception(s) still open; resolve or waive them before posting`, { openExceptions: open });

  const now = new Date();
  const docNo = miroDocNo(now);
  const metadata = JSON.stringify({ requestId: opts.requestId });
  const postMetadata = JSON.stringify({ requestId: opts.requestId, initiatedBy: opts.actor });
  await prisma.$transaction(async (tx) => {
    // Status guard inside the transaction so concurrent posts cannot both succeed.
    const updated = await tx.claim.updateMany({ where: { claimId, status: "Analyzed" }, data: { status: "Posted", postedAt: now, miroDocNo: docNo } });
    if (updated.count !== 1) throw new AuditError(409, "CLAIM_ALREADY_POSTED", "Claim was posted by a concurrent request", { currentStatus: "Posted" });
    if (claim.exceptions.length > 0) {
      await tx.auditLog.create({
        data: {
          logId: randomUUID(),
          timestamp: now,
          actor: opts.actor,
          action: "Exceptions Resolved",
          details: `${claim.exceptions.length} exception(s) resolved after reviewer sign-off; supplier documentation attached.`,
          claimId,
          metadata,
        },
      });
    }
    await tx.auditLog.create({
      data: {
        logId: randomUUID(),
        timestamp: now,
        actor: "SAP S/4HANA Integration",
        action: "Posted to SAP",
        details: `Invoice ${claim.invoiceNumber} posted (MIRO) for ${formatUsd(toCents(claim.amount))}; payment run ${claim.vendor?.paymentTerms ?? "Net 30"}.`,
        claimId,
        metadata: postMetadata,
      },
    });
  });
  opts.revalidate?.(["/dashboard", "/claims", `/claims/${claimId}`, "/audit"]);
  return { claimId, status: "Posted", postedAt: now.toISOString(), miroDocNo: docNo };
}

export type DispositionResult = { exceptionId: string; status: "Resolved" | "Waived" };

export async function dispositionException(
  claimId: string,
  exceptionId: string,
  input: { status: "Resolved" | "Waived"; note: string },
  opts: { requestId: string; actor: string; revalidate?: (paths: string[]) => void },
): Promise<DispositionResult> {
  const [claim, exception] = await Promise.all([
    prisma.claim.findUnique({ where: { claimId }, select: { status: true } }),
    prisma.exception.findUnique({ where: { exceptionId } }),
  ]);
  if (!claim) throw new AuditError(404, "CLAIM_NOT_FOUND", `Claim ${claimId} not found`);
  if (!exception || exception.claimId !== claimId) throw new AuditError(404, "EXCEPTION_NOT_FOUND", `Exception ${exceptionId} not found on ${claimId}`);
  if (claim.status !== "Analyzed") throw new AuditError(409, "CLAIM_NOT_ANALYZED", "Exceptions can only be handled while the claim is Analyzed", { currentStatus: claim.status });
  if (exception.status !== "Open") throw new AuditError(409, "EXCEPTION_ALREADY_HANDLED", `Exception is already ${exception.status}`, { currentStatus: exception.status });

  await prisma.$transaction(async (tx) => {
    const updated = await tx.exception.updateMany({ where: { exceptionId, status: "Open" }, data: { status: input.status, resolvedBy: opts.actor } });
    if (updated.count !== 1) throw new AuditError(409, "EXCEPTION_ALREADY_HANDLED", "Exception was handled by a concurrent request");
    await tx.auditLog.create({
      data: {
        logId: randomUUID(),
        actor: opts.actor,
        action: input.status === "Resolved" ? "Exception Resolved" : "Exception Waived",
        details: `${exception.ruleId} ${exception.anomalyType} ${input.status.toLowerCase()} — ${input.note}`,
        claimId,
        metadata: JSON.stringify({ requestId: opts.requestId }),
      },
    });
  });
  opts.revalidate?.([`/claims/${claimId}`]);
  return { exceptionId, status: input.status };
}
