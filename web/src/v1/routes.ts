import { type Cause, Effect, Layer, Option } from "effect";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { CacheControl } from "../cache.ts";
import { repositories } from "../database.ts";
import { V1Data } from "./data.ts";
import { eventDetailsJson, eventJson, speakersJson } from "./json.ts";
import { isPostgresUuid } from "./uuid.ts";

/**
 * The public v1 API, answering as app/src/app/api/v1/{events,speakers} do:
 * the same paths, status codes, error bodies and response bodies.
 */

const respond = (body: unknown, status: number, cacheControl: CacheControl) =>
  HttpServerResponse.json(body, {
    status,
    headers: { "cache-control": cacheControl },
  });

const notFound = respond(
  { error: "Event not found" },
  404,
  CacheControl.notFound,
);

/** Logs the failure and answers with the app's 500 body for it. */
const failure = (log: string, error: string) => (cause: Cause.Cause<unknown>) =>
  Effect.logError(log, cause).pipe(
    Effect.andThen(respond({ error }, 500, CacheControl.failure)),
  );

const events = HttpRouter.add(
  "GET",
  "/api/v1/events",
  Effect.gen(function* () {
    const rows = yield* V1Data.use((data) => data.listPublishedEvents);
    return yield* respond(
      { events: rows.map(eventJson) },
      200,
      CacheControl.publicData,
    );
  }).pipe(
    Effect.provide(repositories),
    Effect.catchCause(
      failure("Error fetching events:", "Failed to fetch events"),
    ),
  ),
);

/** One event by its id, a uuid; drafts are not found. */
const event = (id: string) =>
  Effect.gen(function* () {
    const row = yield* V1Data.use((data) => data.findPublishedEvent(id));
    if (Option.isNone(row)) return yield* notFound;
    return yield* respond(
      { event: yield* eventDetailsJson(row.value) },
      200,
      CacheControl.publicData,
    );
  }).pipe(
    Effect.provide(repositories),
    Effect.catchCause(
      failure("Error fetching event:", "Failed to fetch event"),
    ),
  );

const eventById = HttpRouter.add(
  "GET",
  "/api/v1/events/:id",
  Effect.flatMap(HttpRouter.params, ({ id }) =>
    // Ids Postgres can't read as a uuid are found nowhere, so there is no
    // query to run; the app's query failed on them instead.
    id !== undefined && isPostgresUuid(id) ? event(id) : notFound,
  ).pipe(
    Effect.catchCause(
      failure("Error fetching event:", "Failed to fetch event"),
    ),
  ),
);

const speakers = HttpRouter.add(
  "GET",
  "/api/v1/speakers",
  Effect.gen(function* () {
    const rows = yield* V1Data.use((data) => data.directory);
    return yield* respond(
      { speakers: speakersJson(rows) },
      200,
      CacheControl.publicData,
    );
  }).pipe(
    Effect.provide(repositories),
    Effect.catchCause(
      failure("Error fetching speakers:", "Failed to fetch speakers"),
    ),
  ),
);

export const v1Routes = Layer.mergeAll(events, eventById, speakers);
