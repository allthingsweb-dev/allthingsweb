import { Context, DateTime, Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { approvalToken } from "../approval.ts";
import { DataSourceError } from "../errors.ts";
import { Planning, PlanningError } from "../planning/planning.ts";
import { DraftTooLong } from "../promo/limits.ts";
import { Promo } from "../promo/promo.ts";
import { Readiness } from "../readiness/readiness.ts";
import {
  type LumaEventFields,
  type LumaPlace,
  LumaWrite,
  type LumaWriteError,
  type ManagedEvent,
} from "./write.ts";

/**
 * The event studio's Luma half: an evening's Luma event is made private,
 * filled in while it is a draft, and made public only with an approval of
 * exactly what goes out.
 *
 * - `create` makes a **private** event (never anything else), from an
 *   idea's pitch when one is named. The calendar feed never carries a
 *   private event, so `bun run luma:drafts --add` stores it as a draft
 *   (src/luma/drafts.ts), which readiness checks and the preview shows.
 * - `update` changes a private event: its name, times, place, its
 *   description from the promotion drafts, its cover. A public one is
 *   refused: what the public sees changes only through `publish`.
 * - `prepare` says exactly what publishing would put out (the event as
 *   Luma has it, with the description the drafts write) and the approval
 *   token for it: the first 16 hex digits of the SHA-256 of that content,
 *   as canonical JSON. It refuses while readiness finds a blocker. An
 *   evening with no talks that comes from an idea keeps the idea's pitch
 *   as its description instead: the drafts write from talks.
 * - `publish` takes that token, works the content out again, and goes on
 *   only if it hashes the same, so what was approved is what goes out.
 *   Then it sets the description and the visibility in one update and
 *   reads the event back to check both took.
 * - `cancelTest` deletes a test event, and only one: private, named
 *   {@link testEventPrefix}, with no guests.
 *
 * Every evening is in San Francisco: times go to Luma in its time zone.
 */

export const timezone = "America/Los_Angeles";

/** How the studio's own test events are named; nothing else may be cancelled. */
export const testEventPrefix = "allthings API test";

/** The site's origin, for the drafts' links. */
export const siteOrigin = "https://allthings.dev";
const photoOrigin = "https://media.allthings.dev";

export class StudioRefused extends Schema.TaggedError<StudioRefused>()(
  "StudioRefused",
  { reason: Schema.String },
) {
  override get message(): string {
    return this.reason;
  }
}

const refuse = (reason: string) => Effect.fail(new StudioRefused({ reason }));

/** An instant with its offset, such as 2026-11-18T18:00:00-08:00, as ISO in UTC. */
export function instant(text: string): string | undefined {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(
      text,
    )
  ) {
    return undefined;
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** What publishing puts out: the event as the public will see it. */
export interface Outgoing {
  readonly lumaEventId: string;
  readonly url: string;
  readonly name: string;
  readonly startAt: string;
  readonly endAt: string | null;
  readonly timezone: string;
  readonly address: string | null;
  readonly coverUrl: string | null;
  readonly descriptionMd: string;
  readonly visibility: "public";
}

export const outgoingOf = (
  event: ManagedEvent,
  descriptionMd: string,
): Outgoing => ({
  lumaEventId: event.id,
  url: event.url,
  name: event.name,
  startAt: event.start_at,
  endAt: event.end_at,
  timezone: event.timezone,
  address: event.geo_address_json?.full_address ?? null,
  coverUrl: event.cover_url,
  descriptionMd,
  visibility: "public",
});

/** What `create` takes. */
export interface CreateInput {
  readonly name: string;
  readonly startAt: string;
  readonly endAt: string;
  readonly place: LumaPlace;
  /** The idea it comes from, whose pitch is its first description. */
  readonly ideaId?: string;
  readonly slug?: string;
  readonly capacity?: number;
}

/** What `update` may change. */
export interface UpdateInput {
  readonly name?: string;
  readonly startAt?: string;
  readonly endAt?: string;
  readonly place?: LumaPlace;
  /** Set the description the promotion drafts write for the draft at this slug. */
  readonly descriptionFromDrafts?: string;
  /** Set the description to this idea's pitch, as `create` does. */
  readonly descriptionFromIdea?: string;
  readonly cover?: {
    readonly bytes: Uint8Array;
    readonly contentType: "image/jpeg" | "image/png";
  };
}

/** Which event: by the draft's slug here, or by Luma's id before the sync has it. */
export type EventRef =
  | { readonly _tag: "Slug"; readonly slug: string }
  | { readonly _tag: "Luma"; readonly lumaEventId: string };

export interface Prepared {
  readonly outgoing: Outgoing;
  readonly token: string;
  /** Visibility now, before publishing. */
  readonly from: ManagedEvent["visibility"];
}

type Failure = StudioRefused | PlanningError | DataSourceError | LumaWriteError;

export interface StudioShape {
  /** The body `create` sends; with `dryRun`, nothing is sent and the id is null. */
  readonly create: (
    input: CreateInput,
    dryRun: boolean,
  ) => Effect.Effect<
    { readonly body: LumaEventFields; readonly lumaEventId: string | null },
    Failure
  >;
  readonly update: (
    ref: EventRef,
    input: UpdateInput,
    dryRun: boolean,
  ) => Effect.Effect<
    { readonly lumaEventId: string; readonly body: LumaEventFields },
    Failure
  >;
  readonly prepare: (slug: string) => Effect.Effect<Prepared, Failure>;
  readonly publish: (
    slug: string,
    token: string,
  ) => Effect.Effect<Prepared & { readonly url: string }, Failure>;
  readonly cancelTest: (
    lumaEventId: string,
  ) => Effect.Effect<{ readonly name: string }, Failure>;
}

const Row = Schema.Struct({
  luma_event_id: Schema.NullOr(Schema.String),
  is_draft: Schema.Boolean,
});

const make = Effect.gen(function* () {
  const sql = yield* SqlClient;
  const luma = yield* LumaWrite;
  const planning = yield* Planning;
  const promo = yield* Promo;
  const readiness = yield* Readiness;

  /** The draft at `slug`, and its Luma event's id. */
  const draftAt = (slug: string) =>
    Effect.gen(function* () {
      const [row] = yield* sql`
        SELECT luma_event_id, is_draft FROM events WHERE slug = ${slug}`.pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Row))),
        Effect.mapError((cause) => new DataSourceError({ cause })),
      );
      if (row === undefined) {
        return yield* refuse(
          `No event, published or draft, has the slug "${slug}".`,
        );
      }
      if (!row.is_draft) return yield* refuse(`${slug} is already published.`);
      if (row.luma_event_id === null) {
        return yield* refuse(`${slug} has no Luma event.`);
      }
      return row.luma_event_id;
    });

  const OwnDescription = Schema.Array(
    Schema.Struct({
      curation: Schema.String,
      talks: Schema.Int,
      pitch: Schema.NullOr(Schema.String),
    }),
  );

  /**
   * The description publishing puts out for the draft at `slug`. The
   * promotion drafts write it from the evening's talks, speakers and
   * hosts; an evening with no talks on record (a trivia night, a social)
   * has nothing for them to write, so one that comes from an idea keeps
   * the idea's pitch, as `create` gave it.
   */
  const publishedDescription = (slug: string) =>
    Effect.gen(function* () {
      // Its talks, and the pitch of the idea it became, unless that idea was
      // dropped (an evening has at most one idea).
      const [own] = yield* sql`
        SELECT
          e.curation,
          (SELECT count(*) FROM event_talks et WHERE et.event_id = e.id)::int AS talks,
          (SELECT i.pitch FROM planning.ideas i
            WHERE i.event_id = e.id AND i.status <> 'dropped') AS pitch
        FROM events e
        WHERE e.slug = ${slug}`.pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(OwnDescription)),
        Effect.mapError((cause) => new DataSourceError({ cause })),
      );
      // A shared evening's Luma page is its organizer's: descriptionFor
      // refuses it, idea or not.
      if (
        own !== undefined &&
        own.curation === "ours" &&
        own.talks === 0 &&
        own.pitch !== null
      ) {
        return own.pitch;
      }
      return yield* descriptionFor(slug);
    });

  /**
   * Writes the program of the idea the draft at `slug` came from (unless
   * that idea was dropped) to its event: planning keeps it while the
   * evening is a draft, and publishing makes it the evening's.
   */
  const applyPlannedProgram = (slug: string) =>
    Effect.flatMap(
      DateTime.now,
      (now) =>
        sql`
        UPDATE events e SET program = i.program,
          updated_at = ${DateTime.formatIso(now)}::timestamptz
        FROM planning.ideas i
        WHERE i.event_id = e.id AND e.slug = ${slug}
          AND i.status <> 'dropped' AND e.program IS DISTINCT FROM i.program`,
    ).pipe(
      Effect.asVoid,
      Effect.mapError((cause) => new DataSourceError({ cause })),
    );

  /** The Luma event, which our calendar must manage. */
  const managed = (lumaEventId: string) =>
    luma.get(lumaEventId).pipe(
      Effect.filterOrElse(
        (event) => event.access === "manage",
        () => refuse(`${lumaEventId} is not our calendar's to change.`),
      ),
    );

  /** The Luma description the promotion drafts write for the draft at `slug`. */
  const descriptionFor = (slug: string) =>
    promo.drafts(slug, { origin: siteOrigin, photoOrigin, draft: true }).pipe(
      Effect.catchTag("EventNotFound", () =>
        refuse(`No draft has the slug "${slug}".`),
      ),
      Effect.catchIf(
        (error): error is DraftTooLong => error instanceof DraftTooLong,
        (error) => refuse(error.message),
      ),
      Effect.flatMap((drafts) =>
        drafts.luma === null
          ? refuse(`${slug} is shared: its Luma page is its organizer's.`)
          : Effect.succeed(drafts.luma),
      ),
    );

  const checkTimes = (start: string | undefined, end: string | undefined) => {
    if (
      start !== undefined &&
      end !== undefined &&
      // Luma may answer with an offset: compare instants, not text.
      Date.parse(end) <= Date.parse(start)
    ) {
      return refuse("An evening ends after it starts.");
    }
    return Effect.void;
  };

  const create = (input: CreateInput, dryRun: boolean) =>
    Effect.gen(function* () {
      yield* checkTimes(input.startAt, input.endAt);
      const idea =
        input.ideaId === undefined
          ? undefined
          : (yield* planning.listIdeas()).find(
              (candidate) => candidate.id === input.ideaId,
            );
      if (input.ideaId !== undefined && idea === undefined) {
        return yield* refuse(`No idea has the id ${input.ideaId}.`);
      }
      if (idea?.event !== null && idea?.event !== undefined) {
        return yield* refuse(
          `That idea already has its evening: ${idea.event.slug}.`,
        );
      }
      const body = {
        name: input.name,
        start_at: input.startAt,
        end_at: input.endAt,
        timezone,
        geo_address_json: input.place,
        // Private, always: an evening goes public only through publish.
        visibility: "private" as const,
        ...(idea === undefined ? {} : { description_md: idea.pitch }),
        ...(input.slug === undefined ? {} : { slug: input.slug }),
        ...(input.capacity === undefined
          ? {}
          : { max_capacity: input.capacity }),
      } satisfies LumaEventFields;
      if (dryRun) return { body, lumaEventId: null };
      const lumaEventId = yield* luma.create(body);
      return { body, lumaEventId };
    });

  /** An idea's pitch, the description `create` gives its event. */
  const pitchOf = (ideaId: string) =>
    Effect.flatMap(planning.listIdeas(), (ideas) => {
      const idea = ideas.find((candidate) => candidate.id === ideaId);
      return idea === undefined
        ? refuse(`No idea has the id ${ideaId}.`)
        : Effect.succeed(idea.pitch);
    });

  const update = (ref: EventRef, input: UpdateInput, dryRun: boolean) =>
    Effect.gen(function* () {
      const lumaEventId =
        ref._tag === "Slug" ? yield* draftAt(ref.slug) : ref.lumaEventId;
      const event = yield* managed(lumaEventId);
      if (event.visibility === "public") {
        return yield* refuse(
          `${event.name} is public: what the public sees changes only through publish.`,
        );
      }
      yield* checkTimes(
        input.startAt ?? event.start_at,
        input.endAt ?? event.end_at ?? undefined,
      );
      if (
        input.descriptionFromDrafts !== undefined &&
        input.descriptionFromIdea !== undefined
      ) {
        return yield* refuse(
          "Set the description from the drafts or from an idea, not both.",
        );
      }
      const description =
        input.descriptionFromDrafts !== undefined
          ? yield* descriptionFor(input.descriptionFromDrafts)
          : input.descriptionFromIdea !== undefined
            ? yield* pitchOf(input.descriptionFromIdea)
            : undefined;
      const coverUrl =
        input.cover === undefined || dryRun
          ? undefined
          : yield* luma.uploadImage(input.cover.bytes, input.cover.contentType);
      const body = {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.startAt === undefined ? {} : { start_at: input.startAt }),
        ...(input.endAt === undefined ? {} : { end_at: input.endAt }),
        ...(input.startAt === undefined && input.endAt === undefined
          ? {}
          : { timezone }),
        ...(input.place === undefined ? {} : { geo_address_json: input.place }),
        ...(description === undefined ? {} : { description_md: description }),
        ...(coverUrl === undefined ? {} : { cover_url: coverUrl }),
      } satisfies LumaEventFields;
      if (Object.keys(body).length === 0 && input.cover === undefined) {
        return yield* refuse("Nothing to change.");
      }
      if (!dryRun) yield* luma.update(lumaEventId, body);
      return { lumaEventId, body };
    });

  const prepare = (slug: string) =>
    Effect.gen(function* () {
      const lumaEventId = yield* draftAt(slug);
      const report = yield* readiness.report({ _tag: "Event", slug });
      const blockers = report.checks.filter(
        (check) => check.level === "blocker",
      );
      if (blockers.length > 0) {
        return yield* refuse(
          `Not ready: ${blockers.map((check) => check.message).join("; ")}.`,
        );
      }
      const event = yield* managed(lumaEventId);
      if (event.visibility === "public") {
        return yield* refuse(`${event.name} is already public on Luma.`);
      }
      const outgoing = outgoingOf(event, yield* publishedDescription(slug));
      return {
        outgoing,
        token: yield* approvalToken(outgoing),
        from: event.visibility,
      };
    });

  const publish = (slug: string, token: string) =>
    Effect.gen(function* () {
      const prepared = yield* prepare(slug);
      if (prepared.token !== token) {
        return yield* refuse(
          `What would go out has changed since ${token} was approved: it is now ${prepared.token}. Read it again with publish ${slug}, and approve that.`,
        );
      }
      const { outgoing } = prepared;
      // The kind of evening its idea planned, kept private until now.
      yield* applyPlannedProgram(slug);
      yield* luma.update(outgoing.lumaEventId, {
        description_md: outgoing.descriptionMd,
        visibility: "public",
      });
      const after = yield* luma.get(outgoing.lumaEventId);
      if (after.visibility !== "public") {
        return yield* refuse(
          `Luma took the update but ${after.name} is still ${after.visibility}.`,
        );
      }
      if ((after.description_md ?? "") !== outgoing.descriptionMd) {
        yield* Effect.logWarning(
          "Luma rewrote the description as it stored it; check the event page.",
        );
      }
      return { ...prepared, url: after.url };
    });

  const cancelTest = (lumaEventId: string) =>
    Effect.gen(function* () {
      const event = yield* managed(lumaEventId);
      const guests = event.guest_counts?.approved.guests ?? 0;
      if (
        !event.name.startsWith(testEventPrefix) ||
        event.visibility !== "private" ||
        guests > 0
      ) {
        return yield* refuse(
          `Only a private test event named "${testEventPrefix}…" with no guests is ever cancelled; ${event.name} is ${event.visibility} with ${guests} guests.`,
        );
      }
      yield* luma.cancel(lumaEventId);
      return { name: event.name };
    });

  return Studio.of({ create, update, prepare, publish, cancelTest });
});

export class Studio extends Context.Service<Studio, StudioShape>()(
  "allthings/Studio",
) {
  static readonly layer = Layer.effect(Studio, make);
}
