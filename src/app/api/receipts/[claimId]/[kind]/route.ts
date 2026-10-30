import { prisma } from "@/lib/db";
import { claimIdSchema, receiptKindSchema } from "@/lib/domain/schemas";
import { mimeForFile, readReceiptFile } from "@/lib/receipts/storage";
import { jsonError, newRequestId } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ claimId: string; kind: string }> }) {
  const requestId = newRequestId();
  const p = await params;
  const id = claimIdSchema.safeParse(p.claimId);
  const kind = receiptKindSchema.safeParse(p.kind);
  if (!id.success || !kind.success) return jsonError(400, "INVALID_PATH", "Unknown receipt", requestId);

  const claim = await prisma.claim.findUnique({ where: { claimId: id.data }, select: { receiptName: true, receiptMime: true, status: true } });
  if (!claim) return jsonError(404, "NOT_FOUND", "Receipt not found", requestId);

  // File names come from the DB record, never from the URL.
  const fileName = kind.data === "original" ? (claim.receiptName ?? "original.svg") : "analyzed.svg";
  if (kind.data === "analyzed" && claim.status === "Pending") return jsonError(404, "NOT_ANALYZED", "Claim has not been analyzed", requestId);
  const data = await readReceiptFile(id.data, fileName);
  if (!data) return jsonError(404, "NOT_FOUND", "Receipt file missing", requestId);

  const contentType = kind.data === "original" ? (claim.receiptMime ?? mimeForFile(fileName)) : "image/svg+xml";
  const download = new URL(req.url).searchParams.get("download") === "1";
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=60",
      "X-Content-Type-Options": "nosniff",
      // SVGs are rendered as images; block scripts if opened directly.
      "Content-Security-Policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${id.data}-${kind.data}.${fileName.split(".").pop()}"`,
    },
  });
}
