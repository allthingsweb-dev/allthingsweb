import { DateTime } from "effect";

/**
 * Days as San Francisco reads them, where every evening is: an instant's
 * day, a day's weekday, and the days between two days. Days are
 * YYYY-MM-DD strings, which compare and sort as dates.
 */

const sanFrancisco = DateTime.zoneMakeNamedUnsafe("America/Los_Angeles");

/** The day `instant` falls on in San Francisco. */
export function sfDay(instant: DateTime.DateTime): string {
  const { year, month, day } = DateTime.toParts(
    DateTime.setZone(instant, sanFrancisco),
  );
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** A day's weekday, 0 for Sunday as Date#getUTCDay counts. */
export const weekdayOf = (day: string): number =>
  new Date(`${day}T12:00:00Z`).getUTCDay();

export const weekdayNames = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** The day `days` after `day` (before, when negative). */
export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`. */
export const daysBetween = (from: string, to: string): number =>
  Math.round(
    (Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) /
      86_400_000,
  );

/** Every day from `from` through `to`, in order. */
export function daysFrom(from: string, to: string): ReadonlyArray<string> {
  const days: Array<string> = [];
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
  return days;
}
