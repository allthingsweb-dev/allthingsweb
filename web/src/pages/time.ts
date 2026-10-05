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

/** "Wed Sep 30, 2026": the day of an evening, on its own page. */
export function fullDate(instant: DateTime.DateTime): string {
  return `${day(instant)}, ${local(instant).year}`;
}

/** Whether two instants fall on the same day in San Francisco. */
function sameDay(a: DateTime.DateTime, b: DateTime.DateTime): boolean {
  const [x, y] = [local(a), local(b)];
  return x.year === y.year && x.month === y.month && x.day === y.day;
}

/**
 * "5:30–8:30 PM", "10:30 AM–8:30 PM", or, past midnight, "8:00 PM – Wed
 * Nov 5, 1:00 AM": when an evening starts and ends, each said once.
 */
export function timeRange(
  start: DateTime.DateTime,
  end: DateTime.DateTime,
): string {
  const [from, to] = [clockTime(start), clockTime(end)];
  if (!sameDay(start, end)) return `${from} – ${day(end)}, ${to}`;
  const [fromClock = "", fromHalf] = from.split(" ");
  const [toClock = "", toHalf] = to.split(" ");
  return fromHalf === toHalf
    ? `${fromClock}–${toClock} ${toHalf ?? ""}`
    : `${from}–${to}`;
}
