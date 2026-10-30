// All money math runs in integer cents. Prisma Decimal values are converted at the boundary.

type DecimalLike = { toString(): string };

export function toCents(value: DecimalLike | number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const str = typeof value === "number" ? value.toFixed(6) : value.toString();
  const negative = str.trim().startsWith("-");
  const [whole, frac = ""] = str.replace("-", "").trim().split(".");
  const fracPadded = (frac + "000").slice(0, 3);
  // Round half away from zero on the third decimal.
  let cents = Number(whole) * 100 + Number(fracPadded.slice(0, 2));
  if (Number(fracPadded[2]) >= 5) cents += 1;
  return negative ? -cents : cents;
}

/** Cents → decimal string with two places, suitable for Prisma Decimal input. */
export function centsToDecimalString(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const str = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
  return negative ? `-${str}` : str;
}

export function centsToNumber(cents: number): number {
  return Math.round(cents) / 100;
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const usdCompact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 2,
});

export function formatUsd(cents: number): string {
  return usd.format(centsToNumber(cents));
}

export function formatUsdCompact(cents: number): string {
  return Math.abs(cents) >= 100_000_000 ? usdCompact.format(centsToNumber(cents)) : formatUsd(cents);
}

export function formatUsdShort(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(centsToNumber(cents));
}

export function sumCents(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}
