import path from "node:path";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { claimIdSchema } from "@/lib/domain/schemas";

// Receipts live outside public/ and are only served through /api/receipts/[claimId]/[kind].

export function receiptsRoot(): string {
  return path.resolve(process.env.RECEIPTS_DIR ?? path.join(process.cwd(), "storage", "receipts"));
}

/** Resolve a claim's folder; the claim ID is validated so no user input can escape the root. */
export function claimDir(claimId: string): string {
  const id = claimIdSchema.parse(claimId);
  const root = receiptsRoot();
  const dir = path.resolve(root, id);
  if (path.dirname(dir) !== root) throw new Error("Invalid receipt path");
  return dir;
}

export function receiptPath(claimId: string, fileName: string): string {
  if (!/^[a-z0-9-]+\.(svg|png|jpe?g|pdf|json)$/i.test(fileName)) throw new Error("Invalid receipt file name");
  return path.join(claimDir(claimId), fileName);
}

export async function writeReceiptFile(claimId: string, fileName: string, data: string | Buffer): Promise<string> {
  const file = receiptPath(claimId, fileName);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, data);
  return file;
}

export async function readReceiptFile(claimId: string, fileName: string): Promise<Buffer | null> {
  try {
    return await readFile(receiptPath(claimId, fileName));
  } catch {
    return null;
  }
}

export async function receiptStat(claimId: string, fileName: string) {
  try {
    return await stat(receiptPath(claimId, fileName));
  } catch {
    return null;
  }
}

export const MIME_BY_EXT: Record<string, string> = {
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  pdf: "application/pdf",
};

export function mimeForFile(fileName: string): string {
  return MIME_BY_EXT[fileName.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
}

/** Detect PNG / JPEG / PDF by magic bytes (never by extension). */
export function sniffMime(buf: Buffer): "image/png" | "image/jpeg" | "application/pdf" | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 5 && buf.subarray(0, 5).toString("ascii") === "%PDF-") return "application/pdf";
  return null;
}
