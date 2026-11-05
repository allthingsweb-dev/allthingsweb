import { statements } from "./statements.ts";

/**
 * All Things Web Hack-Evening (evt-4tdtev7Ap2qLcPW) was on Wednesday
 * 2025-03-12 from 5:30 to 8:30 PM in San Francisco, as its Luma event says:
 * 2025-03-13 00:30 to 03:30 UTC. Its row held 2025-03-12 17:30 to 20:30
 * UTC, seven hours early (10:30 AM to 1:30 PM there): the local time stored
 * as UTC. Luma is where an evening's time is set, and the calendar feed
 * can't correct it, since the event is private on Luma and the feed
 * carries no private event, so it is set here once.
 *
 * One statement. It matches the evening only while it still holds the
 * wrong times, so on any other database, and on a second run, it changes
 * nothing. Data only, with no schema change, so it has no drizzle twin.
 */
export const lumaEventId = "evt-4tdtev7Ap2qLcPW";
export const wrong = {
  start: "2025-03-12T17:30:00Z",
  end: "2025-03-12T20:30:00Z",
} as const;
export const right = {
  start: "2025-03-13T00:30:00Z",
  end: "2025-03-13T03:30:00Z",
} as const;

export const hackEveningTime: ReadonlyArray<string> = [
  `UPDATE "public"."events"
  SET "start_date" = '${right.start}', "end_date" = '${right.end}', "updated_at" = now()
  WHERE "luma_event_id" = '${lumaEventId}'
    AND "start_date" = '${wrong.start}' AND "end_date" = '${wrong.end}'`,
];

export default statements(hackEveningTime);
