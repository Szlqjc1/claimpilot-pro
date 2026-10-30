import { z } from "zod";
import { CATEGORIES, CLAIM_STATUSES, DEPARTMENTS, RISK_LEVELS, ANOMALY_TYPES } from "./constants";

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
const confidence = z.number().min(0).max(1);
const nullableString = z.string().trim().min(1).nullable();

export const lineItemSchema = z.object({
  line: z.number().int().positive(),
  partNumber: nullableString,
  description: z.string().min(1),
  quantity: z.number(),
  unit: nullableString,
  unitPrice: z.number(),
  amount: z.number(),
  confidence: confidence.default(0.9),
});
export type LineItem = z.infer<typeof lineItemSchema>;

export const boundingBoxSchema = z.object({
  field: z.string().min(1),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0).max(1),
  h: z.number().min(0).max(1),
  page: z.number().int().positive().default(1),
});
export type BoundingBox = z.infer<typeof boundingBoxSchema>;

/**
 * Extraction contract (Section 7.4). Three additive, nullable fields were added
 * because deterministic rules need them: projectCode (R-01/R-02), remitTo (R-17),
 * attendees (R-12). See DECISIONS.md.
 */
export const extractionSchema = z.object({
  vendor: z.object({
    name: nullableString,
    taxId: nullableString,
    address: nullableString,
    confidence: confidence,
  }),
  invoiceNumber: nullableString,
  invoiceDate: isoDay.nullable(),
  dueDate: isoDay.nullable(),
  currency: nullableString,
  poNumber: nullableString,
  releaseNumber: nullableString,
  grnNumber: nullableString,
  gatePassNumber: nullableString,
  projectCode: nullableString.default(null),
  shipTo: z.object({ plant: nullableString, address: nullableString }),
  billTo: nullableString,
  paymentTerms: nullableString,
  remitTo: z
    .object({ bankName: nullableString, accountLast4: z.string().regex(/^\d{4}$/).nullable() })
    .nullable()
    .default(null),
  attendees: z
    .object({ count: z.number().int().nonnegative().nullable(), names: z.array(z.string()) })
    .nullable()
    .default(null),
  lineItems: z.array(lineItemSchema),
  subtotal: z.number().nullable(),
  salesTax: z.number().nullable(),
  freight: z.number().nullable(),
  otherCharges: z.number().nullable(),
  total: z.number(),
  taxRate: z.number().min(0).max(1).nullable(),
  approval: z.object({ name: z.string().min(1), level: z.string().min(1) }).nullable(),
  fieldConfidence: z.record(z.string(), confidence),
  boundingBoxes: z.array(boundingBoxSchema).default([]),
  warnings: z.array(z.string()).default([]),
});
export type Extraction = z.infer<typeof extractionSchema>;

export const fixtureSchema = z.object({
  claimId: z.string(),
  ocrText: z.string().min(1),
  ocrConfidence: confidence,
  extraction: extractionSchema,
  boxes: z.array(boundingBoxSchema),
});
export type ReceiptFixture = z.infer<typeof fixtureSchema>;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Validate + normalize an extraction: round money, check the totals identity. */
export function normalizeExtraction(input: unknown): Extraction {
  const parsed = extractionSchema.parse(input);
  const money = (n: number | null) => (n === null ? null : round2(n));
  const out: Extraction = {
    ...parsed,
    currency: parsed.currency ? parsed.currency.toUpperCase() : null,
    subtotal: money(parsed.subtotal),
    salesTax: money(parsed.salesTax),
    freight: money(parsed.freight),
    otherCharges: money(parsed.otherCharges),
    total: round2(parsed.total),
    lineItems: parsed.lineItems.map((li) => ({ ...li, unitPrice: round2(li.unitPrice), amount: round2(li.amount) })),
    warnings: [...parsed.warnings],
  };
  const gap = totalsGap(out);
  if (Math.abs(gap) > 0.02) {
    const msg = `Totals do not reconcile: subtotal + tax + freight + other differs from total by $${Math.abs(gap).toFixed(2)}.`;
    if (!out.warnings.includes(msg)) out.warnings.push(msg);
  }
  return out;
}

/** (subtotal + salesTax + freight + otherCharges) − total, in dollars. */
export function totalsGap(e: Pick<Extraction, "subtotal" | "salesTax" | "freight" | "otherCharges" | "total">): number {
  const sum = (e.subtotal ?? 0) + (e.salesTax ?? 0) + (e.freight ?? 0) + (e.otherCharges ?? 0);
  return round2(sum - e.total);
}

/** Parse Extracted_Data safely; returns null + error instead of throwing. */
export function parseExtractedData(raw: string | null | undefined):
  | { ok: true; data: Extraction }
  | { ok: false; error: string }
  | null {
  if (!raw) return null;
  try {
    const json: unknown = JSON.parse(raw);
    const res = extractionSchema.safeParse(json);
    if (!res.success) return { ok: false, error: res.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
    return { ok: true, data: res.data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Invalid JSON" };
  }
}

export const claimIdSchema = z.string().regex(/^CLM-\d{4}-\d{4}$/, "Invalid claim ID");
export const receiptKindSchema = z.enum(["original", "analyzed"]);

export const departmentSchema = z.enum(DEPARTMENTS);
export const categorySchema = z.enum(CATEGORIES);
export const statusSchema = z.enum(CLAIM_STATUSES);
export const riskLevelSchema = z.enum(RISK_LEVELS);
export const anomalyTypeSchema = z.enum(ANOMALY_TYPES);

const emptyToUndefined = (v: unknown) => (v === "" || v === "all" ? undefined : v);

export const RANGE_OPTIONS = ["30d", "90d", "12m", "custom"] as const;

export const claimFiltersSchema = z.object({
  q: z.preprocess(emptyToUndefined, z.string().trim().max(80).optional()),
  department: z.preprocess(emptyToUndefined, departmentSchema.optional()).catch(undefined),
  category: z.preprocess(emptyToUndefined, categorySchema.optional()).catch(undefined),
  status: z.preprocess(emptyToUndefined, statusSchema.optional()).catch(undefined),
  risk: z.preprocess(emptyToUndefined, riskLevelSchema.optional()).catch(undefined),
  anomaly: z.preprocess(emptyToUndefined, anomalyTypeSchema.optional()).catch(undefined),
  project: z.preprocess(emptyToUndefined, z.string().max(40).optional()).catch(undefined),
  vendor: z.preprocess(emptyToUndefined, z.string().max(80).optional()).catch(undefined),
  range: z.preprocess(emptyToUndefined, z.enum(RANGE_OPTIONS).optional()).catch(undefined),
  from: z.preprocess(emptyToUndefined, isoDay.optional()).catch(undefined),
  to: z.preprocess(emptyToUndefined, isoDay.optional()).catch(undefined),
  page: z.coerce.number().int().min(1).max(1000).catch(1).default(1),
});
export type ClaimFilters = z.infer<typeof claimFiltersSchema>;

export const newClaimSchema = z.object({
  employee: z.string().trim().min(2).max(80),
  department: departmentSchema,
  projectCode: z.preprocess(emptyToUndefined, z.string().trim().max(40).optional()),
  category: categorySchema,
  amount: z
    .string()
    .trim()
    .regex(/^\d{1,9}(\.\d{1,2})?$/, "Amount must be a USD value like 1234.56"),
  vendorName: z.string().trim().min(2).max(120),
  invoiceNumber: z.preprocess(emptyToUndefined, z.string().trim().max(40).optional()),
  poNumber: z.preprocess(emptyToUndefined, z.string().trim().max(20).optional()),
});
