import { Context, DateTime, Effect, Exit, Layer, Option, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { approvalToken } from "../approval.ts";
import { isLumaDefaultCover } from "../cover.ts";
import { DataSourceError } from "../errors.ts";
import { Planning, PlanningError } from "../planning/planning.ts";
import {
  actorFor,
  type DraftLogEntry,
  logAfterLuma,
  logDraft,
} from "../planning/draft-log.ts";
import { DraftTooLong } from "../promo/limits.ts";
import { Promo } from "../promo/promo.ts";
import { Readiness } from "../readiness/readiness.ts";
import { siteOrigin } from "../site.ts";
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
 *   description from the promotion drafts. A public one is refused: what
 *   the public sees changes only through `publish`. Its cover is set
 *   only by `bun run luma cover` (src/luma/cover.ts), drawn from its
 *   facts, so no other cover can be put on it here.
 * - `prepare` says exactly what publishing would put out (the event as
 *   Luma has it, with the description the drafts write) and the approval
 *   token for it: the first 16 hex digits of the SHA-256 of that content,
 *   as canonical JSON. It refuses while readiness finds a blocker, and
 *   while the cover Luma shows isn't the one we set: Luma's default, or
 *   any other (readiness can only see what we recorded). An
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

export { siteOrigin } from "../site.ts";
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
}

/** Which event: by the draft's slug here, or by Luma's id before the sync has it. */
export type EventRef =
  | { readonly _tag: "Slug"; readonly slug: string }
  | { readonly _tag: "Luma"; readonly lumaEventId: string };

/** Someone in the lineup planning kept for the draft, copied at publish. */
export interface PlannedPerson {
  readonly role: string;
  readonly position: number;
  readonly profileId: string;
  readonly name: string;
}

export interface Prepared {
  readonly outgoing: Outgoing;
  /**
   * The private lineup publishing copies to the evening. The token covers
   * it too, so a lineup changed after approval is refused.
   */
  readonly lineup: ReadonlyArray<PlannedPerson>;
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
  generated_cover_url: Schema.NullOr(Schema.String),
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
        SELECT luma_event_id, is_draft, generated_cover_url
        FROM events WHERE slug = ${slug}`.pipe(
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
      return {
        lumaEventId: row.luma_event_id,
        generatedCoverUrl: row.generated_cover_url,
      };
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
  const ProgramRows = Schema.Array(Schema.Struct({ before: Schema.String }));

  /** The program the event had before, or null when nothing changed. */
  const applyPlannedProgram = (slug: string) =>
    Effect.flatMap(
      DateTime.now,
      (now) =>
        sql`
        UPDATE events e SET program = i.program,
          updated_at = ${DateTime.formatIso(now)}::timestamptz
        FROM planning.ideas i, events was
        WHERE i.event_id = e.id AND e.slug = ${slug} AND was.id = e.id
          AND i.status <> 'dropped' AND e.program IS DISTINCT FROM i.program
        RETURNING was.program AS before`,
    ).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(ProgramRows)),
      Effect.map(([row]) => row?.before ?? null),
      Effect.mapError((cause) => new DataSourceError({ cause })),
    );

  /** Gives the event at `slug` back the program it had. */
  const restoreProgram = (slug: string, program: string) =>
    sql`UPDATE events SET program = ${program} WHERE slug = ${slug}`;

  const roles = ["organizer", "co-host", "mc"];

  const PlannedRows = Schema.Array(
    Schema.Struct({
      role: Schema.String,
      position: Schema.Int,
      profileId: Schema.String,
      name: Schema.String,
    }),
  );

  /** The private lineup planning keeps for the draft at `slug`, in order. */
  const plannedLineup = (slug: string) =>
    sql`
      SELECT d.role, d.position, d.profile_id AS "profileId", p.name
      FROM planning.draft_people d
      JOIN events e ON e.id = d.event_id
      JOIN profiles p ON p.id = d.profile_id
      WHERE e.slug = ${slug}`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(PlannedRows)),
      Effect.map((rows) =>
        rows.toSorted(
          (a, b) =>
            roles.indexOf(a.role) - roles.indexOf(b.role) ||
            a.position - b.position ||
            a.profileId.localeCompare(b.profileId),
        ),
      ),
      Effect.mapError((cause) => new DataSourceError({ cause })),
    );

  const Copied = Schema.Array(
    Schema.Struct({
      eventId: Schema.String,
      profileId: Schema.String,
      role: Schema.String,
    }),
  );

  /**
   * Copies the private lineup planning keeps for the draft at `slug`
   * (planning.draft_people) to its public one, leaving anyone already on
   * it as they are: the rows it added.
   */
  const copyPlannedLineup = (slug: string) =>
    Effect.flatMap(DateTime.now, (now) => {
      const at = DateTime.formatIso(now);
      return sql`
        INSERT INTO event_people (event_id, profile_id, role, position, source, created_at, updated_at)
        SELECT d.event_id, d.profile_id, d.role, d.position, 'site',
          ${at}::timestamptz, ${at}::timestamptz
        FROM planning.draft_people d JOIN events e ON e.id = d.event_id
        WHERE e.slug = ${slug}
        ON CONFLICT DO NOTHING
        RETURNING event_id AS "eventId", profile_id AS "profileId", role`;
    }).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Copied)),
      Effect.mapError((cause) => new DataSourceError({ cause })),
    );

  const ClaimRows = Schema.Array(
    Schema.Struct({
      status: Schema.Literals(["publishing", "published"]),
      claimedAt: Schema.String,
    }),
  );

  /** How long a publish may take before its claim counts as abandoned. */
  const claimLasts = 5 * 60 * 1000;

  /** Same people in the same parts and order. */
  const sameLineup = (
    a: ReadonlyArray<PlannedPerson>,
    b: ReadonlyArray<PlannedPerson>,
  ) =>
    a.length === b.length &&
    a.every(
      (person, i) =>
        person.role === b[i]?.role &&
        person.profileId === b[i]?.profileId &&
        person.position === b[i]?.position,
    );

  /**
   * Claims the draft at `slug`'s publish and writes what planning kept
   * private for it (the idea's program, the lineup), all in one
   * transaction with the evening's row locked, so no lineup change or
   * other publish can come between. Refused while another publish holds
   * it (for `claimLasts`), once it is published, and when the lineup is
   * not the one approved. The program it had, and the rows it copied.
   */
  const claimPublish = (slug: string, approved: ReadonlyArray<PlannedPerson>) =>
    Effect.flatMap(DateTime.now, (now) =>
      sql.withTransaction(
        Effect.gen(function* () {
          const at = DateTime.formatIso(now);
          yield* sql`SELECT id FROM events WHERE slug = ${slug} FOR UPDATE`;
          const [claim] = yield* sql`
            SELECT pb.status, to_char(pb.claimed_at AT TIME ZONE 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "claimedAt"
            FROM planning.publishes pb JOIN events e ON e.id = pb.event_id
            WHERE e.slug = ${slug}`.pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(ClaimRows)),
          );
          if (claim?.status === "published") {
            return yield* refuse(`${slug} is already published.`);
          }
          if (
            claim !== undefined &&
            DateTime.toEpochMillis(now) - Date.parse(claim.claimedAt) <
              claimLasts
          ) {
            return yield* refuse(
              `Another publish of ${slug} started at ${claim.claimedAt} and hasn't finished: wait, then read it again with --dry-run.`,
            );
          }
          yield* sql`
            INSERT INTO planning.publishes (event_id, status, claimed_at)
            SELECT id, 'publishing', ${at}::timestamptz FROM events WHERE slug = ${slug}
            ON CONFLICT (event_id) DO UPDATE
              SET status = 'publishing', claimed_at = excluded.claimed_at,
                published_at = NULL`;
          if (!sameLineup(yield* plannedLineup(slug), approved)) {
            return yield* refuse(
              `The lineup of ${slug} changed since it was approved: read it again with --dry-run, and approve that.`,
            );
          }
          const before = yield* applyPlannedProgram(slug);
          const copied = yield* copyPlannedLineup(slug);
          yield* log({
            event: { slug },
            command: "luma publish",
            summary: `Claimed its publish${before === null ? "" : `, its program set from its idea (was ${before})`}, with ${copied.length} of its lineup copied to the public one.`,
            payload: {
              programBefore: before,
              copied: copied.map(({ profileId, role }) => ({
                profileId,
                role,
              })),
            },
          });
          return { before, copied };
        }),
      ),
    ).pipe(
      Effect.catchTag(["SqlError", "SchemaError"], (cause) =>
        Effect.fail(new DataSourceError({ cause })),
      ),
    );

  /** Appends to a draft's log on this service's connection (src/planning/draft-log.ts). */
  const log = (entry: DraftLogEntry) =>
    logDraft(entry).pipe(
      Effect.provideService(SqlClient, sql),
      Effect.catchTag("ActorRequired", (missing) => refuse(missing.reason)),
    );

  /** Records the draft at `slug` published, as Luma now says, with its line in the log. */
  const markPublished = (slug: string, url: string) =>
    Effect.flatMap(DateTime.now, (now) =>
      sql.withTransaction(
        Effect.andThen(
          sql`
          UPDATE planning.publishes pb SET status = 'published',
            published_at = ${DateTime.formatIso(now)}::timestamptz
          FROM events e WHERE e.id = pb.event_id AND e.slug = ${slug}`,
          log({
            event: { slug },
            command: "luma publish",
            summary: `Published: public on Luma at ${url}.`,
            payload: { url },
          }),
        ),
      ),
    ).pipe(
      Effect.asVoid,
      Effect.mapError((cause) => new DataSourceError({ cause })),
    );

  /** Takes back the rows `copyPlannedLineup` added. */
  const uncopy = (rows: typeof Copied.Type) =>
    sql`
      DELETE FROM event_people ep
      USING jsonb_to_recordset(${JSON.stringify(rows)}::jsonb)
        AS r("eventId" uuid, "profileId" uuid, role text)
      WHERE ep.event_id = r."eventId" AND ep.profile_id = r."profileId"
        AND ep.role = r.role`;

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
      if (!dryRun) yield* actorFor(refuse);
      const lumaEventId =
        ref._tag === "Slug"
          ? (yield* draftAt(ref.slug)).lumaEventId
          : ref.lumaEventId;
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
      const body = {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.startAt === undefined ? {} : { start_at: input.startAt }),
        ...(input.endAt === undefined ? {} : { end_at: input.endAt }),
        ...(input.startAt === undefined && input.endAt === undefined
          ? {}
          : { timezone }),
        ...(input.place === undefined ? {} : { geo_address_json: input.place }),
        ...(description === undefined ? {} : { description_md: description }),
      } satisfies LumaEventFields;
      if (Object.keys(body).length === 0) {
        return yield* refuse("Nothing to change.");
      }
      if (!dryRun) {
        yield* luma.update(lumaEventId, body);
        yield* logAfterLuma(
          {
            event: { lumaEventId },
            command: "luma update",
            summary: `Changed on Luma: ${Object.keys(body).join(", ")}.`,
            payload: {
              fields: Object.keys(body),
              ...(body.name === undefined ? {} : { name: body.name }),
              ...(body.start_at === undefined
                ? {}
                : { startAt: body.start_at }),
              ...(body.end_at === undefined ? {} : { endAt: body.end_at }),
            },
          },
          refuse,
        ).pipe(Effect.provideService(SqlClient, sql));
      }
      return { lumaEventId, body };
    });

  const prepare = (slug: string) =>
    Effect.gen(function* () {
      const { lumaEventId, generatedCoverUrl } = yield* draftAt(slug);
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
      // What Luma shows now, against what we set: readiness sees only the
      // record, and a cover changed on Luma since is not ours.
      if (isLumaDefaultCover(event.cover_url)) {
        return yield* refuse(
          `Not ready: its cover on Luma is Luma's default (${event.cover_url ?? ""}). Draw and set ours with bun run luma cover ${slug} --dry-run, then --approve <token>.`,
        );
      }
      if (event.cover_url === null || event.cover_url !== generatedCoverUrl) {
        return yield* refuse(
          `Not ready: its cover on Luma (${event.cover_url ?? "none"}) isn't the one we set (${generatedCoverUrl ?? "none"}). Draw and set ours with bun run luma cover ${slug} --dry-run, then --approve <token>.`,
        );
      }
      const outgoing = outgoingOf(event, yield* publishedDescription(slug));
      const lineup = yield* plannedLineup(slug);
      return {
        outgoing,
        lineup,
        // An evening without a private lineup hashes as it always has.
        token: yield* approvalToken(
          lineup.length === 0 ? outgoing : { ...outgoing, lineup },
        ),
        from: event.visibility,
      };
    });

  const publish = (slug: string, token: string) =>
    Effect.gen(function* () {
      yield* actorFor(refuse);
      const prepared = yield* prepare(slug);
      if (prepared.token !== token) {
        return yield* refuse(
          `What would go out has changed since ${token} was approved: it is now ${prepared.token}. Read it again with publish ${slug}, and approve that.`,
        );
      }
      const { outgoing } = prepared;
      // What planning kept private (the idea's program, the lineup) is
      // written first, under a claim no other publish can take, so the
      // evening is never public without it.
      const { before, copied } = yield* claimPublish(slug, prepared.lineup);
      const outcome = yield* Effect.exit(
        Effect.gen(function* () {
          yield* luma.update(outgoing.lumaEventId, {
            description_md: outgoing.descriptionMd,
            visibility: "public",
          });
          const read = yield* luma.get(outgoing.lumaEventId);
          if (read.visibility !== "public") {
            return yield* refuse(
              `Luma took the update but ${read.name} is still ${read.visibility}.`,
            );
          }
          return read;
        }),
      );
      if (Exit.isFailure(outcome)) {
        // Only once Luma says the event is still not public does the draft
        // get its own back, all at once, and the claim go. When Luma can't
        // say, everything stays, and the claim lapses after claimLasts.
        const now = yield* Effect.option(luma.get(outgoing.lumaEventId));
        if (Option.isSome(now) && now.value.visibility === "public") {
          yield* markPublished(slug, now.value.url).pipe(
            Effect.catchTag("DataSourceError", () =>
              refuse(
                `${now.value.name} is public on Luma, but its publish wasn't recorded: lineup changes stay refused while its claim stands.`,
              ),
            ),
          );
        } else if (Option.isSome(now)) {
          yield* sql
            .withTransaction(
              Effect.all([
                before === null ? Effect.void : restoreProgram(slug, before),
                copied.length === 0 ? Effect.void : uncopy(copied),
                sql`
                  DELETE FROM planning.publishes pb USING events e
                  WHERE e.id = pb.event_id AND e.slug = ${slug}`,
                log({
                  event: { slug },
                  command: "luma publish",
                  summary: `Luma didn't make it public: ${[
                    before === null ? [] : ["its program"],
                    copied.length === 0
                      ? []
                      : [`the ${copied.length} copied to its public lineup`],
                  ]
                    .flat()
                    .map((what) => `${what} taken back, `)
                    .join("")}its claim let go.`,
                  payload: { programRestored: before, uncopied: copied.length },
                }),
              ]),
            )
            .pipe(
              Effect.catchTag("SqlError", () =>
                refuse(
                  `Luma didn't make ${outgoing.name} public, and taking back what this publish wrote failed: its claim lapses in five minutes, then publish again.`,
                ),
              ),
            );
        }
        return yield* Effect.failCause(outcome.cause);
      }
      const after = outcome.value;
      yield* markPublished(slug, after.url).pipe(
        Effect.catchTag("DataSourceError", () =>
          refuse(
            `${after.name} is public on Luma, but its publish wasn't recorded: lineup changes stay refused while its claim stands.`,
          ),
        ),
      );
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
