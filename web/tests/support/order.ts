/**
 * The app reads an event's talks, their speakers, its hosts and its photos
 * without ORDER BY, so their order is the query planner's. The Worker lists
 * them in the order they were attached (core's choice, pinned by its own
 * tests and by "attach order" here). Parity compares them in a canonical
 * order instead; keys keep their order, so the JSON is still compared as
 * written.
 */

export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };

const canonical = (values: ReadonlyArray<Json>): Array<Json> =>
  values
    .map((value) => [JSON.stringify(value), value] as const)
    .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, value]) => value);

/** `event` with its attached lists, and each talk's speakers, in canonical order. */
export function ignoringAttachOrder(event: Json): Json {
  if (event === null || typeof event !== "object" || Array.isArray(event)) {
    return event;
  }
  const out: Record<string, Json> = {};
  for (const [key, value] of Object.entries(event)) {
    if (!Array.isArray(value)) {
      out[key] = value;
    } else if (key === "talks") {
      out[key] = canonical(
        value.map((talk) =>
          talk !== null && typeof talk === "object" && !Array.isArray(talk)
            ? {
                ...talk,
                speakers: canonical((talk["speakers"] as Array<Json>) ?? []),
              }
            : talk,
        ),
      );
    } else if (key === "hosts" || key === "images") {
      out[key] = canonical(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}
