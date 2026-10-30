import { formatInTimeZone } from "date-fns-tz";
import { DISPLAY_TIMEZONE } from "./constants";

/** Display a UTC instant in America/Detroit with the ET label. */
export function formatEt(date: Date | string | null | undefined, pattern = "MMM d, yyyy h:mm a"): string {
  if (!date) return "—";
  return `${formatInTimeZone(new Date(date), DISPLAY_TIMEZONE, pattern)} ET`;
}

export function formatEtDate(date: Date | string | null | undefined): string {
  if (!date) return "—";
  return formatInTimeZone(new Date(date), DISPLAY_TIMEZONE, "MMM d, yyyy");
}

/** Parse an ISO calendar date (YYYY-MM-DD) as UTC midnight. */
export function isoDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function isWeekend(isoDay: string): boolean {
  const d = isoDate(isoDay).getUTCDay();
  return d === 0 || d === 6;
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

export function hoursBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / 3_600_000;
}
