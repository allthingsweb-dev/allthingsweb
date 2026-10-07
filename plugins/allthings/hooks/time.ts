/**
 * San Francisco time, worked out by hand: the US rules for Pacific time
 * (UTC-8, and UTC-7 from the second Sunday of March at 2am to the first
 * Sunday of November at 2am), so nothing depends on the runtime's time zone
 * data. Evenings carry `timeZone: "America/Los_Angeles"`.
 */

const HOUR = 3_600_000;
const MINUTE = 60_000;

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
] as const;

/** The day of the month of the nth Sunday (1-based) of a month, in UTC terms. */
function nthSunday(year: number, month: number, n: number): number {
  const first = new Date(Date.UTC(year, month, 1)).getUTCDay();
  return 1 + ((7 - first) % 7) + (n - 1) * 7;
}

/** Pacific time's offset from UTC at an instant, in hours: -7 or -8. */
export function pacificOffset(ms: number): number {
  const year = new Date(ms).getUTCFullYear();
  // 2am PST is 10:00 UTC; 2am PDT is 09:00 UTC.
  const starts = Date.UTC(year, 2, nthSunday(year, 2, 2), 10);
  const ends = Date.UTC(year, 10, nthSunday(year, 10, 1), 9);
  return ms >= starts && ms < ends ? -7 : -8;
}

/** An instant's wall clock in San Francisco, read through UTC getters. */
export type Wall = {
  year: number;
  month: number;
  day: number;
  weekday: number;
  hour: number;
  minute: number;
};

export function pacific(ms: number): Wall {
  const shifted = new Date(ms + pacificOffset(ms) * HOUR);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

/** Whether two instants fall on the same San Francisco calendar day. */
export function isSameDay(a: number, b: number): boolean {
  const x = pacific(a);
  const y = pacific(b);
  return x.year === y.year && x.month === y.month && x.day === y.day;
}

/** "thu oct 9" */
export function dayOf(ms: number): string {
  const wall = pacific(ms);
  return `${WEEKDAYS[wall.weekday]} ${MONTHS[wall.month]} ${wall.day}`;
}

/** "5:30pm", or "6pm" on the hour. */
export function clockOf(ms: number): string {
  const { hour, minute } = pacific(ms);
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  const minutes = minute === 0 ? "" : `:${String(minute).padStart(2, "0")}`;
  return `${twelve}${minutes}${hour < 12 ? "am" : "pm"}`;
}

/** "5:30–8:30pm", or "11am–2pm" across noon. */
export function spanOf(startMs: number, endMs: number): string {
  const start = clockOf(startMs);
  const end = clockOf(endMs);
  const startMeridiem = start.slice(-2);
  return startMeridiem === end.slice(-2)
    ? `${start.slice(0, -2)}–${end}`
    : `${start}–${end}`;
}

/** Whether an evening counts as one by the brand's rule: it starts at 4pm or later, or before 5am. */
export function isEveningStart(ms: number): boolean {
  const { hour } = pacific(ms);
  return hour >= 16 || hour < 5;
}

/** "2h 14m", "45m", or "1m" for anything under a minute. */
export function untilOf(fromMs: number, toMs: number): string {
  const minutes = Math.max(1, Math.ceil((toMs - fromMs) / MINUTE));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}
