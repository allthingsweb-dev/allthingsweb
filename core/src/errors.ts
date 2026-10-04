import { Schema } from "effect";

/**
 * The database could not be reached or returned rows that do not decode. Both
 * are worth a retry from the client's side, and neither is the caller's fault,
 * so they share one error that surfaces as "temporarily unavailable".
 */
export class DataSourceError extends Schema.TaggedError<DataSourceError>()(
  "DataSourceError",
  { cause: Schema.Defect() },
) {}

/** No published event has this slug. Drafts are reported the same way. */
export class EventNotFound extends Schema.TaggedError<EventNotFound>()(
  "EventNotFound",
  { slug: Schema.String },
) {
  /**
   * The text clients see. The CLI maps it to its "not found" exit code, so it
   * must stay identical to app/src/lib/public-api/errors.ts.
   */
  override get message(): string {
    return `No published event has the slug "${this.slug}". Use list_events to find one.`;
  }
}

/** No redirect is stored under this slug. */
export class RedirectNotFound extends Schema.TaggedError<RedirectNotFound>()(
  "RedirectNotFound",
  { slug: Schema.String },
) {}
