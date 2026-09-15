import ICAL from "ical.js";
import { TZDate } from "@date-fns/tz";

export const ALL_THINGS_WEB_CALENDAR_ID = "cal-3AAimKnRVQEId4r";
const CALENDAR_TIMEZONE = "America/Los_Angeles";

export type PublicLumaEvent = {
  lumaEventId: string;
  name: string;
  startDate: Date;
  endDate: Date;
  location: string | null;
  isDraft: boolean;
};

function toDate(time: ICAL.Time, property: ICAL.Property | null): Date {
  const timezone = time.isDate
    ? CALENDAR_TIMEZONE
    : property?.getParameter("tzid");

  if (timezone || time.zone.tzid === "floating") {
    return new Date(
      new TZDate(
        time.year,
        time.month - 1,
        time.day,
        time.hour,
        time.minute,
        time.second,
        String(timezone || CALENDAR_TIMEZONE),
      ).getTime(),
    );
  }

  return time.toJSDate();
}

export function parsePublicLumaCalendar(text: string): PublicLumaEvent[] {
  if (!text.trim().endsWith("END:VCALENDAR")) {
    throw new Error("Luma returned an incomplete calendar");
  }
  const calendar = new ICAL.Component(ICAL.parse(text));
  if (calendar.name !== "vcalendar") {
    throw new Error("Luma did not return an iCalendar feed");
  }

  const events = new Map<
    string,
    { event: PublicLumaEvent; sequence: number }
  >();
  for (const component of calendar.getAllSubcomponents("vevent")) {
    const event = new ICAL.Event(component);
    const id = event.uid?.match(/^(evt-[A-Za-z0-9]+)@events\.lu\.ma$/)?.[1];
    if (!id || !event.summary?.trim() || !event.startDate || !event.endDate) {
      throw new Error("Luma returned an event missing its ID, title or dates");
    }
    if (event.isRecurring() || event.isRecurrenceException()) {
      throw new Error(`Luma returned an unexpanded recurring event: ${id}`);
    }

    const startDate = toDate(
      event.startDate,
      component.getFirstProperty("dtstart"),
    );
    const endDate = toDate(event.endDate, component.getFirstProperty("dtend"));
    if (
      !Number.isFinite(startDate.getTime()) ||
      !Number.isFinite(endDate.getTime()) ||
      endDate <= startDate
    ) {
      throw new Error(`Luma returned invalid dates for ${id}`);
    }

    const visibility = component.getFirstPropertyValue("class");
    const isDraft =
      component.getFirstPropertyValue("status") === "CANCELLED" ||
      visibility === "PRIVATE" ||
      visibility === "CONFIDENTIAL";
    const previous = events.get(id);
    if (!previous || event.sequence >= previous.sequence) {
      events.set(id, {
        event: {
          lumaEventId: id,
          name: event.summary.trim(),
          startDate,
          endDate,
          location: event.location?.trim() || null,
          isDraft,
        },
        sequence: event.sequence,
      });
    }
  }

  if (events.size === 0) {
    throw new Error(
      "Luma returned an empty calendar; stored events were not changed",
    );
  }
  return Array.from(events.values(), ({ event }) => event);
}

export async function fetchPublicLumaEvents(
  calendarId = ALL_THINGS_WEB_CALENDAR_ID,
): Promise<PublicLumaEvent[]> {
  if (!/^cal-[A-Za-z0-9]+$/.test(calendarId)) {
    throw new Error("Invalid Luma calendar ID");
  }
  const url = new URL("https://api.luma.com/ics/get");
  url.searchParams.set("entity", "calendar");
  url.searchParams.set("id", calendarId);
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
    headers: { accept: "text/calendar" },
  });
  if (!response.ok) {
    throw new Error(`Luma calendar request failed: ${response.status}`);
  }
  return parsePublicLumaCalendar(await response.text());
}
