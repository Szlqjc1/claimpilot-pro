import { randomBytes, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { newClaimSchema } from "@/lib/domain/schemas";
import { aiConfig } from "@/lib/ai/provider";
import { sniffMime, writeReceiptFile } from "@/lib/receipts/storage";
import { sha256 } from "@/lib/receipts/invoice";
import { isSameOrigin, jsonError, newRequestId, rateLimit } from "@/lib/api";
import { requireUser } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "application/pdf": "pdf" };

/** P1 intake: multipart form → new Pending claim with the receipt stored outside public/. */
export async function POST(req: Request) {
  const requestId = newRequestId();
  if (!(await requireUser({ api: true }))) return jsonError(401, "UNAUTHENTICATED", "Sign in to continue", requestId);
  if (!isSameOrigin(req)) return jsonError(403, "CROSS_ORIGIN", "Cross-origin requests are not allowed", requestId);
  if (!rateLimit("intake", 20)) return jsonError(429, "RATE_LIMITED", "Too many uploads; try again in a minute", requestId);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError(400, "INVALID_FORM", "Expected multipart/form-data", requestId);
  }
  const fields = newClaimSchema.safeParse(Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string")));
  if (!fields.success) {
    return jsonError(400, "VALIDATION_FAILED", fields.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), requestId);
  }
  const file = form.get("receipt");
  if (!(file instanceof File) || file.size === 0) return jsonError(422, "RECEIPT_MISSING", "Attach a receipt (PNG, JPEG or PDF)", requestId);
  const { maxUploadBytes } = aiConfig();
  if (file.size > maxUploadBytes) return jsonError(422, "RECEIPT_TOO_LARGE", `Receipt exceeds ${Math.round(maxUploadBytes / 1048576)} MB`, requestId);
  const buf = Buffer.from(await file.arrayBuffer());
  const mime = sniffMime(buf);
  if (!mime) return jsonError(422, "RECEIPT_UNSUPPORTED", "Only PNG, JPEG or PDF files are accepted (checked by file signature)", requestId);

  const f = fields.data;
  const year = new Date().getUTCFullYear();
  const last = await prisma.claim.findFirst({ where: { claimId: { startsWith: `CLM-${year}-` } }, orderBy: { claimId: "desc" }, select: { claimId: true } });
  const claimId = `CLM-${year}-${String((last ? Number(last.claimId.slice(-4)) : 0) + 1).padStart(4, "0")}`;
  const fileName = `${randomBytes(8).toString("hex")}.${EXT[mime]}`;
  await writeReceiptFile(claimId, fileName, buf);

  const [vendor, project, po] = await Promise.all([
    prisma.vendor.findFirst({ where: { name: f.vendorName } }),
    f.projectCode ? prisma.project.findUnique({ where: { code: f.projectCode } }) : null,
    f.poNumber ? prisma.purchaseOrder.findUnique({ where: { poNumber: f.poNumber } }) : null,
  ]);
  if (f.projectCode && !project) return jsonError(422, "UNKNOWN_PROJECT", `Project ${f.projectCode} is not in SAP`, requestId);

  const now = new Date();
  await prisma.$transaction([
    prisma.claim.create({
      data: {
        claimId,
        employee: f.employee,
        department: f.department,
        projectCode: f.projectCode ?? null,
        category: f.category,
        amount: f.amount,
        status: "Pending",
        originalReceipt: `/api/receipts/${claimId}/original`,
        vendorId: vendor?.vendorId ?? null,
        vendorName: f.vendorName,
        invoiceNumber: f.invoiceNumber ?? null,
        poNumber: po?.poNumber ?? null,
        receiptHash: sha256(buf),
        receiptMime: mime,
        receiptName: fileName,
        source: "upload",
        submittedAt: now,
      },
    }),
    prisma.auditLog.create({
      data: { logId: randomUUID(), timestamp: now, actor: f.employee, action: "Claim Submitted", details: `Claim submitted by ${f.employee}`, claimId, metadata: JSON.stringify({ requestId, upload: true, bytes: buf.length, mime }) },
    }),
  ]);
  ["/dashboard", "/claims", "/audit"].forEach((p) => revalidatePath(p));
  return NextResponse.json({ claimId }, { status: 201, headers: { "x-request-id": requestId } });
}
