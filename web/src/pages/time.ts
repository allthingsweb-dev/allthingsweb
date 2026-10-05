import { DateTime } from "effect";

/**
 * Times as pages print them: on the wall clocks of San Francisco, whatever
 * the server's or the reader's zone. Built from the zone's date and time
 * parts rather than a locale's formatter, so the text never depends on the
 * runtime's locale data.
 */

/** Where every evening happens; the contract's `timeZone` says the same. */
export const timeZone = DateTime.zoneMakeNamedUnsafe("America/Los_Angeles");

const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const months = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const twoDigits = (value: number) => String(value).padStart(2, "0");

/** The instant's date and time in San Francisco. */
function local(instant: DateTime.DateTime): DateTime.DateTime.PartsWithWeekday {
  return DateTime.toParts(DateTime.setZone(instant, timeZone));
}

/** "09.30.26": dates in lists. */
export function listDate(instant: DateTime.DateTime): string {
  const { month, day: date, year: fullYear } = local(instant);
  return `${twoDigits(month)}.${twoDigits(date)}.${twoDigits(fullYear % 100)}`;
}

/** 2026: the year an evening happened in, in San Francisco. */
export function year(instant: DateTime.DateTime): number {
  return local(instant).year;
}

/** "Wed Sep 30": the day of an evening. */
export function day(instant: DateTime.DateTime): string {
  const { weekDay, month, day: date } = local(instant);
  return `${weekdays[weekDay] ?? ""} ${months[month - 1] ?? ""} ${date}`;
}

/** "5:30 PM", "12:05 AM": the time of an evening. */
export function clockTime(instant: DateTime.DateTime): string {
  const { hour, minute } = local(instant);
  const twelveHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelveHour}:${twoDigits(minute)} ${hour < 12 ? "AM" : "PM"}`;
}
