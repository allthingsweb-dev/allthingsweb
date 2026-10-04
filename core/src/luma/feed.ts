import ICAL from "ical.js";
import { DateTime, Effect, Option, Schema } from "effect";

/**
 * Luma's public iCalendar feed of a calendar, read the way the app reads it
 * (app/src/lib/luma/public-calendar.ts): every event, past and future, in one
 * document. The feed is the whole calendar, so a feed that does not read in
 * full is rejected as a whole and nothing is written.
 *
 * ical.js reads the iCalendar text (line folding, escapes, value types), as it
 * does in the app. What it reads is then decoded with Schema, and anything the
 * app would reject fails here with a {@link LumaFeedError}.
 */

/** The All Things Web calendar; `LUMA_CALENDAR_API_ID` names another. */
export const allThingsWebCalendarId = "cal-3AAimKnRVQEId4r";

/** Dates, and times without a zone of their own, are read in this zone. */
export const calendarTimeZone = "America/Los_Angeles";

/**
 * The LOCATION Luma writes when it hides an event's venue: the event's own
 * page. It is no venue. Postgres reads the same pattern (`~*`) when the sync
 * recovers venues it once overwrote with it.
 */
export const locationPlaceholderPattern =
  "^https?://(www[.])?(luma[.]com|lu[.]ma)/event/evt-[A-Za-z0-9]+/?([?#].*)?$";
const locationPlaceholder = new RegExp(locationPlaceholderPattern, "i");

/** The feed did not read as a complete calendar of valid events. */
export class LumaFeedError extends Schema.TaggedError<LumaFeedError>()(
  "LumaFeedError",
  { reason: Schema.String, cause: Schema.optional(Schema.Defect()) },
) {
  override get message(): string {
    return this.reason;
  }
}

/** An event on the calendar, as the sync stores it. */
export const FeedEvent = Schema.Struct({
  lumaEventId: Schema.String.check(Schema.isPattern(/^evt-[A-Za-z0-9]+$/)),
  name: Schema.String.check(Schema.isNonEmpty(), Schema.isTrimmed()),
  startDate: Schema.DateTimeUtc,
  endDate: Schema.DateTimeUtc,
  /** The venue as Luma writes it, or null when Luma shows none. */
  location: Schema.NullOr(
    Schema.String.check(Schema.isNonEmpty(), Schema.isTrimmed()),
  ),
  /** Cancelled, private and confidential events are kept off the site. */
  isDraft: Schema.Boolean,
}).check(
  Schema.makeFilter(
    (event) =>
      DateTime.isGreaterThan(event.endDate, event.startDate) ||
      "ends before it starts",
  ),
);
export type FeedEvent = typeof FeedEvent.Type;

const IcalTime = Schema.declare(
  (input): input is ICAL.Time => input instanceof ICAL.Time,
  { expected: "a date or date-time" },
);

/**
 * One VEVENT's properties as ical.js reads them, before any rule of ours. The
 * app tolerates exactly this: anything else throws there and fails here.
 */
const VEvent = Schema.Struct({
  uid: Schema.String.check(
    Schema.isPattern(/^evt-[A-Za-z0-9]+@events\.lu\.ma$/),
  ),
  summary: Schema.String.check(
    Schema.makeFilter((summary) => summary.trim() !== "" || "is blank"),
  ),
  start: IcalTime,
  end: IcalTime,
  /** The zone each time is written in, if it names one. */
  startZone: Schema.optional(Schema.String),
  endZone: Schema.optional(Schema.String),
  /** The feed lists each occurrence; a rule to expand is not ours to read. */
  recurring: Schema.Literal(false),
  sequence: Schema.NullOr(Schema.Number),
  location: Schema.NullOr(Schema.String),
  /** CLASS and STATUS, as text. */
  visibility: Schema.String,
  status: Schema.String,
});
type VEvent = typeof VEvent.Type;

/** What ical.js reads from `component`; its getters throw on malformed values. */
function readVEvent(component: ICAL.Component): Record<string, unknown> {
  const event = new ICAL.Event(component);
  const start: unknown = event.startDate;
  return {
    uid: event.uid,
    summary: event.summary,
    start,
    // The end of an event without DTEND is derived from its start.
    end: start === null ? null : event.endDate,
    startZone: component.getFirstProperty("dtstart")?.getParameter("tzid"),
    endZone: component.getFirstProperty("dtend")?.getParameter("tzid"),
    recurring: event.isRecurring() || event.isRecurrenceException(),
    sequence: event.sequence,
    location: event.location,
    visibility: String(component.getFirstPropertyValue("class") ?? ""),
    status: String(component.getFirstPropertyValue("status") ?? ""),
  };
}

/**
 * The instant `time` names. Dates start at midnight in the calendar's zone;
 * times in a named zone, or in none (floating), are wall-clock times there.
 * A wall-clock time a daylight-saving change skips is read with the offset
 * before the change, and one it repeats as its first occurrence (RFC 5545,
 * 3.3.5), which is what the app's TZDate does in America/Los_Angeles.
 */
function toInstant(
  time: ICAL.Time,
  zone: string | undefined,
): Option.Option<DateTime.Utc> {
  const named = time.isDate ? calendarTimeZone : zone;
  if (named || time.zone.tzid === "floating") {
    return DateTime.makeZoned(
      {
        year: time.year,
        month: time.month,
        day: time.day,
        hour: time.hour,
        minute: time.minute,
        second: time.second,
      },
      {
        timeZone: named || calendarTimeZone,
        adjustForTimeZone: true,
        disambiguation: "compatible",
      },
    ).pipe(Option.map(DateTime.toUtc));
  }
  return DateTime.make(time.toUnixTime() * 1000);
}

/** The venue Luma shows, or null for none and for its placeholder. */
export function venueOf(location: string | null): string | null {
  if (!location) return null;
  const trimmed = location.trim();
  return locationPlaceholder.test(trimmed) ? null : trimmed || null;
}

/** Cancelled, private and confidential events are drafts, in any casing. */
export function isDraft(vevent: {
  readonly visibility: string;
  readonly status: string;
}): boolean {
  const visibility = vevent.visibility.trim().toUpperCase();
  return (
    vevent.status.trim().toUpperCase() === "CANCELLED" ||
    visibility === "PRIVATE" ||
    visibility === "CONFIDENTIAL"
  );
}

const invalid = (reason: string) => (cause: unknown) =>
  new LumaFeedError({ reason, cause });

const toFeedEvent = (vevent: VEvent) => {
  const lumaEventId = vevent.uid.slice(0, vevent.uid.indexOf("@"));
  return Effect.gen(function* () {
    const startDate = toInstant(vevent.start, vevent.startZone);
    const endDate = toInstant(vevent.end, vevent.endZone);
    if (Option.isNone(startDate) || Option.isNone(endDate)) {
      return yield* new LumaFeedError({
        reason: `Luma returned invalid dates for ${lumaEventId}`,
      });
    }
    return yield* Schema.decodeEffect(FeedEvent)({
      lumaEventId,
      name: vevent.summary.trim(),
      startDate: startDate.value,
      endDate: endDate.value,
      location: venueOf(vevent.location),
      isDraft: isDraft(vevent),
    }).pipe(
      Effect.mapError(
        invalid(`Luma returned an invalid event: ${lumaEventId}`),
      ),
    );
  });
};

/**
 * The events of a calendar feed, each once. When an event is listed more than
 * once, its highest SEQUENCE wins, and the later listing wins a tie; it keeps
 * the place of its first listing. Fails, writing nothing anywhere, unless the
 * whole feed reads.
 */
export const parseCalendar = (
  text: string,
): Effect.Effect<ReadonlyArray<FeedEvent>, LumaFeedError> =>
  Effect.gen(function* () {
    if (!text.trim().endsWith("END:VCALENDAR")) {
      return yield* new LumaFeedError({
        reason: "Luma returned an incomplete calendar",
      });
    }
    const calendar = yield* Effect.try({
      try: () => new ICAL.Component(ICAL.parse(text)),
      catch: invalid("Luma did not return an iCalendar feed"),
    });
    if (calendar.name !== "vcalendar") {
      return yield* new LumaFeedError({
        reason: "Luma did not return an iCalendar feed",
      });
    }

    const events = new Map<
      string,
      { readonly event: FeedEvent; readonly sequence: number | null }
    >();
    for (const component of calendar.getAllSubcomponents("vevent")) {
      const raw = yield* Effect.try({
        try: () => readVEvent(component),
        catch: invalid("Luma returned an event that does not read"),
      });
      const vevent = yield* Schema.decodeUnknownEffect(VEvent)(raw).pipe(
        Effect.mapError(invalid("Luma returned an event that does not decode")),
      );
      const event = yield* toFeedEvent(vevent);
      const previous = events.get(event.lumaEventId);
      // As the app compares them: a missing SEQUENCE counts as 0.
      if (
        previous === undefined ||
        (vevent.sequence ?? 0) >= (previous.sequence ?? 0)
      ) {
        events.set(event.lumaEventId, { event, sequence: vevent.sequence });
      }
    }

    if (events.size === 0) {
      return yield* new LumaFeedError({
        reason:
          "Luma returned an empty calendar; stored events were not changed",
      });
    }
    return Array.from(events.values(), ({ event }) => event);
  });
