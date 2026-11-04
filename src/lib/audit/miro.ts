import { randomBytes } from "node:crypto";
import { toIsoDate } from "@/lib/domain/dates";

/** SAP MIRO document number: MIRO-yyyyMMdd-<6 hex>. Date part is the UTC posting date. */
export function miroDocNo(postedAt: Date, hex: string = randomBytes(3).toString("hex")): string {
  return `MIRO-${toIsoDate(postedAt).replace(/-/g, "")}-${hex.slice(0, 6).toUpperCase()}`;
}
