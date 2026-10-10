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

/** A day on the calendar, "YYYY-MM-DD": it has no zone. */
const calendarDay = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A day's parts, as `DateTime.toParts` names them. */
interface DayParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

/** How many days `month` (1–12) of `fullYear` has, leap years counted. */
function daysIn(fullYear: number, month: number): number {
  if (month === 2) {
    const leap =
      (fullYear % 4 === 0 && fullYear % 100 !== 0) || fullYear % 400 === 0;
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** The year, month and day a "YYYY-MM-DD" day names: never a February 30th. */
function dayParts(isoDay: string): DayParts {
  const [, fullYear, month, date] = isoDay.match(calendarDay) ?? [];
  const parts = {
    year: Number(fullYear),
    month: Number(month),
    day: Number(date),
  };
  if (
    fullYear === undefined ||
    parts.month < 1 ||
    parts.month > 12 ||
    parts.day < 1 ||
    parts.day > daysIn(parts.year, parts.month)
  ) {
    throw new RangeError(`Expected a YYYY-MM-DD day, got "${isoDay}"`);
  }
  return parts;
}

/**
 * "2026.09.30": a simple date, the one way the site writes a day on its
 * own: in lists of evenings, under talks and on contact sheets. Year first
 * and whole, so it reads in the order it sorts. Where people decide whether
 * they can make it, pages say the weekday and the time instead (`fullDate`,
 * `day`, `timeRange`). `when` is an instant, dated in San Francisco, or a
 * calendar day, "YYYY-MM-DD", which is dated as it is.
 */
export function simpleDate(when: DateTime.DateTime | string): string {
  const parts: DayParts =
    typeof when === "string" ? dayParts(when) : local(when);
  return `${String(parts.year).padStart(4, "0")}.${twoDigits(parts.month)}.${twoDigits(parts.day)}`;
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
