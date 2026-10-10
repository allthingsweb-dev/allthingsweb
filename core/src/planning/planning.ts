import { Context, DateTime, Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";
import { DataSourceError } from "../errors.ts";
import {
  type CompanyRef,
  type HostChanges,
  HostProspect,
  type HostStatus,
  Id,
  Idea,
  type IdeaChanges,
  type IdeaStatus,
  isAvailableOn,
  type NewContact,
  type NewHostProspect,
  type NewIdea,
  type NewWantedSpeaker,
  type NoteSubject,
  type PersonRef,
  SearchHit,
  type SpeakerChanges,
  SpeakerStatus,
  WantedSpeaker,
  type WindowInput,
} from "./model.ts";
import {
  ActorRequired,
  currentActor,
  type DraftLogEntry,
  logDraft,
} from "./draft-log.ts";

/**
 * Organizers' planning (migrations/0012_planning.ts): ideas for evenings,
 * speakers we'd like on stage and when they're free, companies we'd like to
 * host, and notes on the people and companies we know. The CLI
 * (scripts/plan.ts) and the admin MCP server's planning tools both run
 * through here, so they can never disagree.
 *
 * Every change runs in one transaction and returns the row as it now is.
 * People and companies are named by id or by exact name (any case), events
 * by slug; a name two rows share is refused with both ids, never guessed.
 * Every list is ordered, so the same rows always read the same.
 *
 * The rows are private. Nothing here is read by the site, and it runs only
 * as a role that may use the planning schema: the studio
 * (infra/scripts/studio.ts) or the database owner, never site_reader or
 * site_sync (tests/planning-privacy.test.ts).
 */

/** A change that can't be made as asked; nothing was written. */
export class PlanningError extends Schema.TaggedError<PlanningError>()(
  "PlanningError",
  { reason: Schema.String },
) {
  override get message(): string {
    return this.reason;
  }
}

const refuse = (reason: string) => Effect.fail(new PlanningError({ reason }));

const isIdShaped = Schema.is(Id);

// Not a type guard: an id and a name are both strings.
const isId = (value: string): boolean => isIdShaped(value);

/** What a window can't say, if anything. */
export function windowProblem(window: WindowInput): string | undefined {
  if (
    window.startsOn === undefined &&
    window.endsOn === undefined &&
    window.note === undefined
  ) {
    return "An availability window needs a start, an end or a note.";
  }
  if (
    window.startsOn !== undefined &&
    window.endsOn !== undefined &&
    window.startsOn > window.endsOn
  ) {
    return `An availability window can't end (${window.endsOn}) before it starts (${window.startsOn}).`;
  }
  return undefined;
}

/** `value` for ILIKE, matched anywhere, with its own % _ and \ taken literally. */
export const containsPattern = (value: string): string =>
  `%${value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;

/** `column`, a timestamptz, as an ISO instant in UTC, whatever the session's time zone. */
const iso = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

const eventRefJson = (alias: string) =>
  `json_build_object('slug', ${alias}.slug, 'name', ${alias}.name, 'startDate', ${iso(`${alias}.start_date`)}, 'isDraft', ${alias}.is_draft)`;

const contactJson = (alias: string) =>
  `json_build_object('id', ${alias}.id, 'name', ${alias}.name, 'email', ${alias}.email, 'url', ${alias}.url, 'company', (SELECT s.name FROM sponsors s WHERE s.id = ${alias}.sponsor_id))`;

const notesJson = (where: string) =>
  `COALESCE((SELECT json_agg(json_build_object('id', n.id, 'body', n.body, 'author', n.author, 'createdAt', ${iso("n.created_at")}) ORDER BY n.created_at, n.id) FROM planning.notes n WHERE ${where}), '[]'::json)`;

const ideaJson = `json_build_object(
  'id', i.id, 'title', i.title, 'pitch', i.pitch, 'program', i.program,
  'topic', i.topic, 'status', i.status,
  'event', (SELECT ${eventRefJson("e")} FROM events e WHERE e.id = i.event_id),
  'inspiredBy', (SELECT ${eventRefJson("e")} FROM events e WHERE e.id = i.inspired_by_event_id),
  'createdAt', ${iso("i.created_at")}, 'updatedAt', ${iso("i.updated_at")}
)`;

const speakerJson = `json_build_object(
  'id', w.id,
  'person', CASE WHEN w.profile_id IS NOT NULL
    THEN json_build_object('kind', 'profile', 'profileId', p.id, 'name', p.name)
    ELSE json_build_object('kind', 'contact', 'contact', ${contactJson("c")}) END,
  'status', w.status,
  'topics', COALESCE((SELECT json_agg(t.topic ORDER BY t.topic) FROM planning.wanted_speaker_topics t WHERE t.wanted_speaker_id = w.id), '[]'::json),
  'availability', COALESCE((SELECT json_agg(json_build_object('id', a.id, 'kind', a.kind, 'startsOn', a.starts_on::text, 'endsOn', a.ends_on::text, 'note', a.note) ORDER BY a.starts_on NULLS FIRST, a.ends_on NULLS LAST, a.created_at, a.id) FROM planning.availability a WHERE a.wanted_speaker_id = w.id), '[]'::json),
  'note', w.note,
  'notes', ${notesJson("n.profile_id = w.profile_id OR n.contact_id = w.contact_id")},
  'createdAt', ${iso("w.created_at")}, 'updatedAt', ${iso("w.updated_at")}
)`;

/** `$1` is the time "last hosted" is read at. */
const hostJson = `json_build_object(
  'id', h.id,
  'company', CASE WHEN h.sponsor_id IS NOT NULL
    THEN json_build_object('kind', 'host', 'sponsorId', s.id, 'name', s.name)
    ELSE json_build_object('kind', 'new', 'name', h.company_name) END,
  'contact', CASE WHEN c.id IS NULL THEN NULL ELSE ${contactJson("c")} END,
  'status', h.status, 'note', h.note,
  'lastHosted', (SELECT ${eventRefJson("e")} FROM event_sponsors es JOIN events e ON e.id = es.event_id
    WHERE es.sponsor_id = h.sponsor_id AND NOT e.is_draft AND e.start_date <= $1::timestamptz
    ORDER BY e.start_date DESC, e.id LIMIT 1),
  'timesHosted', (SELECT count(*) FROM event_sponsors es JOIN events e ON e.id = es.event_id
    WHERE es.sponsor_id = h.sponsor_id AND NOT e.is_draft)::int,
  'notes', ${notesJson("n.sponsor_id = h.sponsor_id")},
  'createdAt', ${iso("h.created_at")}, 'updatedAt', ${iso("h.updated_at")}
)`;

const Rows = <S extends Schema.Top>(row: S) =>
  Schema.Array(Schema.Struct({ row }));

export interface SpeakerFilter {
  readonly topic?: string;
  readonly status?: SpeakerStatus;
  /** Only those free on this day (YYYY-MM-DD), as {@link isAvailableOn} reads their windows. */
  readonly availableOn?: string;
}

type Failure = PlanningError | DataSourceError;

export interface PlanningShape {
  readonly addIdea: (idea: NewIdea) => Effect.Effect<Idea, Failure>;
  readonly updateIdea: (
    id: string,
    changes: IdeaChanges,
  ) => Effect.Effect<Idea, Failure>;
  readonly listIdeas: (filter?: {
    readonly status?: IdeaStatus;
  }) => Effect.Effect<ReadonlyArray<Idea>, Failure>;
  readonly addWantedSpeaker: (
    person: PersonRef,
    speaker: NewWantedSpeaker,
  ) => Effect.Effect<WantedSpeaker, Failure>;
  readonly updateWantedSpeaker: (
    id: string,
    changes: SpeakerChanges,
  ) => Effect.Effect<WantedSpeaker, Failure>;
  readonly listWantedSpeakers: (
    filter?: SpeakerFilter,
  ) => Effect.Effect<ReadonlyArray<WantedSpeaker>, Failure>;
  readonly addHostProspect: (
    company: CompanyRef,
    contact: PersonRef | undefined,
    prospect: NewHostProspect,
  ) => Effect.Effect<HostProspect, Failure>;
  readonly updateHostProspect: (
    id: string,
    changes: HostChanges,
  ) => Effect.Effect<HostProspect, Failure>;
  readonly listHostProspects: (filter?: {
    readonly status?: HostStatus;
  }) => Effect.Effect<ReadonlyArray<HostProspect>, Failure>;
  readonly addNote: (
    subject: NoteSubject,
    body: string,
    author?: string,
  ) => Effect.Effect<
    { readonly id: string; readonly about: string; readonly body: string },
    Failure
  >;
  readonly search: (
    query: string,
  ) => Effect.Effect<ReadonlyArray<SearchHit>, Failure>;
  /** The draft at `slug`'s private lineup, by role and order. */
  readonly draftLineup: (
    slug: string,
  ) => Effect.Effect<ReadonlyArray<DraftPerson>, Failure>;
  /**
   * Makes `people` the whole private lineup of the draft at `slug`, in
   * their order within each role. A published evening is refused: its
   * lineup is the public one (core/backfill/lineups.json).
   */
  readonly setDraftLineup: (
    slug: string,
    people: ReadonlyArray<{
      readonly role: DraftRole;
      readonly profile: string;
    }>,
  ) => Effect.Effect<ReadonlyArray<DraftPerson>, Failure>;
  /** The draft at `slug`'s private talks, in running order. */
  readonly draftTalks: (
    slug: string,
  ) => Effect.Effect<ReadonlyArray<DraftTalk>, Failure>;
  /**
   * Adds `talk` after the draft at `slug`'s other private talks, with its
   * people named by their wanted speaker's id, in order. A published
   * evening is refused: its talks are the public ones
   * (core/backfill/lineups.json).
   */
  readonly addDraftTalk: (
    slug: string,
    talk: NewDraftTalk,
  ) => Effect.Effect<ReadonlyArray<DraftTalk>, Failure>;
  /** Takes the private talk `id` off the draft at `slug`, people and all. */
  readonly removeDraftTalk: (
    slug: string,
    id: string,
  ) => Effect.Effect<ReadonlyArray<DraftTalk>, Failure>;
}

/** What a draft talk is: one speaker's talk, a panel, or a fireside chat. */
export type DraftTalkKind = "talk" | "panel" | "fireside";

/** A part on a draft talk. */
export type DraftTalkRole = "speaker" | "panelist" | "moderator";

/** The parts each kind of draft talk has room for. */
export const draftTalkRoles: Readonly<
  Record<DraftTalkKind, ReadonlyArray<DraftTalkRole>>
> = {
  talk: ["speaker"],
  panel: ["moderator", "panelist"],
  fireside: ["moderator", "speaker"],
};

/** Someone on a draft talk, as their wanted speaker record has them. */
export interface DraftTalkPerson {
  readonly role: DraftTalkRole;
  readonly position: number;
  readonly wantedSpeakerId: string;
  readonly name: string;
  /** Whether they've said yes: their wanted speaker's status. */
  readonly status: SpeakerStatus;
  /** Their profile, if they have one; the published evening needs it. */
  readonly profileId: string | null;
}

/** A talk, panel or fireside on an unpublished evening, kept private. */
export interface DraftTalk {
  readonly id: string;
  readonly position: number;
  readonly kind: DraftTalkKind;
  readonly title: string;
  readonly description: string | null;
  readonly people: ReadonlyArray<DraftTalkPerson>;
}

/** A draft talk to add. */
export interface NewDraftTalk {
  readonly kind: DraftTalkKind;
  readonly title: string;
  readonly description?: string;
  readonly people: ReadonlyArray<{
    readonly role: DraftTalkRole;
    /** Their wanted speaker's id. */
    readonly wantedSpeaker: string;
  }>;
}

const DraftTalkRows = Schema.Array(
  Schema.Struct({
    id: Schema.String,
    position: Schema.Int,
    kind: Schema.Literals(["talk", "panel", "fireside"]),
    title: Schema.String,
    description: Schema.NullOr(Schema.String),
    people: Schema.Array(
      Schema.Struct({
        role: Schema.Literals(["speaker", "panelist", "moderator"]),
        position: Schema.Int,
        wantedSpeakerId: Schema.String,
        name: Schema.String,
        status: SpeakerStatus,
        profileId: Schema.NullOr(Schema.String),
      }),
    ),
  }),
);

const WantedRows = Schema.Array(
  Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    status: SpeakerStatus,
  }),
);

/** A part someone has at an evening, as event_people names it. */
export type DraftRole = "organizer" | "co-host" | "mc";

/** Someone in an unpublished evening's private lineup. */
export interface DraftPerson {
  readonly role: DraftRole;
  readonly position: number;
  readonly profileId: string;
  readonly name: string;
}

const DraftPersonRows = Schema.Array(
  Schema.Struct({
    role: Schema.Literals(["organizer", "co-host", "mc"]),
    position: Schema.Int,
    profileId: Schema.String,
    name: Schema.String,
  }),
);

/** A draft lineup's roles, in the order it lists them. */
export const draftRoleOrder = ["organizer", "co-host", "mc"] as const;
const roleOrder = draftRoleOrder;

const make = Effect.gen(function* () {
  const sql = yield* SqlClient;

  /**
   * Folds SQL and decoding failures into DataSourceError, and a missing
   * ALLTHINGS_ACTOR into a refusal, keeping PlanningError.
   */
  const run = <A>(
    effect: Effect.Effect<
      A,
      PlanningError | SqlError | Schema.SchemaError | ActorRequired
    >,
  ): Effect.Effect<A, Failure> =>
    effect.pipe(
      Effect.catchTag(["SqlError", "SchemaError"], (cause) =>
        Effect.fail(new DataSourceError({ cause })),
      ),
      Effect.catchTag("ActorRequired", (missing) => refuse(missing.reason)),
    );

  /** Appends to a draft's log on this service's connection (src/planning/draft-log.ts). */
  const log = (entry: DraftLogEntry) =>
    logDraft(entry).pipe(Effect.provideService(SqlClient, sql));

  /**
   * A write: it says who is writing first (ALLTHINGS_ACTOR), then runs in
   * one transaction, with the entries it appends to a draft's log.
   */
  const inTransaction = <A>(
    effect: Effect.Effect<
      A,
      PlanningError | SqlError | Schema.SchemaError | ActorRequired
    >,
  ) => run(Effect.andThen(currentActor, sql.withTransaction(effect)));

  const IdRows = Schema.Array(Schema.Struct({ id: Schema.String }));
  const NamedRows = Schema.Array(
    Schema.Struct({ id: Schema.String, name: Schema.String }),
  );

  /** The one row `ref` names among `rows`, or why there isn't one. */
  const one = (
    what: string,
    ref: string,
    rows: ReadonlyArray<{ readonly id: string; readonly name: string }>,
  ) => {
    const [row, ...others] = rows;
    if (row === undefined) return refuse(`No ${what} is "${ref}".`);
    if (others.length > 0) {
      return refuse(
        `${rows.length} ${what}s are named "${ref}": ${rows.map((r) => r.id).join(", ")}. Name one by its id.`,
      );
    }
    return Effect.succeed(row);
  };

  const profile = (ref: string) =>
    sql`SELECT id, name FROM profiles WHERE ${
      isId(ref) ? sql`id = ${ref}` : sql`lower(name) = lower(${ref.trim()})`
    } ORDER BY id`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(NamedRows)),
      Effect.flatMap((rows) => one("profile", ref, rows)),
    );

  const host = (ref: string) =>
    sql`SELECT id, name FROM sponsors WHERE ${
      isId(ref) ? sql`id = ${ref}` : sql`lower(name) = lower(${ref.trim()})`
    } ORDER BY id`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(NamedRows)),
      Effect.flatMap((rows) => one("hosting company", ref, rows)),
    );

  const contact = (id: string) =>
    (isId(id)
      ? sql`SELECT id, name FROM planning.contacts WHERE id = ${id}`
      : Effect.succeed([])
    ).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(NamedRows)),
      Effect.flatMap((rows) => one("contact", id, rows)),
    );

  const eventId = (slug: string) =>
    sql`SELECT id FROM events WHERE slug = ${slug}`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(IdRows)),
      Effect.flatMap(([row]) =>
        row === undefined
          ? refuse(`No event, published or draft, has the slug "${slug}".`)
          : Effect.succeed(row.id),
      ),
    );

  const newContact = (person: NewContact) =>
    Effect.gen(function* () {
      const sponsorId =
        person.company === undefined ? null : (yield* host(person.company)).id;
      const [row] = yield* sql`
        INSERT INTO planning.contacts (name, email, url, sponsor_id)
        VALUES (${person.name.trim()}, ${person.email ?? null}, ${person.url ?? null}, ${sponsorId})
        RETURNING id`.pipe(Effect.flatMap(Schema.decodeUnknownEffect(IdRows)));
      if (row === undefined) return yield* Effect.die("INSERT returned no id");
      return row.id;
    });

  /** The profile or contact a person reference names, creating a new contact. */
  const person = (ref: PersonRef) =>
    Effect.gen(function* () {
      if (ref._tag === "Profile") {
        return { profileId: (yield* profile(ref.ref)).id, contactId: null };
      }
      return {
        profileId: null,
        contactId:
          ref._tag === "Contact"
            ? (yield* contact(ref.id)).id
            : yield* newContact(ref.contact),
      };
    });

  const checkWindows = (windows: ReadonlyArray<WindowInput>) =>
    Effect.forEach(windows, (window) => {
      const problem = windowProblem(window);
      return problem === undefined ? Effect.void : refuse(problem);
    });

  const insertWindows = (
    wantedSpeakerId: string,
    windows: ReadonlyArray<WindowInput>,
  ) =>
    Effect.forEach(
      windows,
      (window) => sql`
        INSERT INTO planning.availability (wanted_speaker_id, kind, starts_on, ends_on, note)
        VALUES (${wantedSpeakerId}, ${window.kind ?? "available"},
          ${window.startsOn ?? null}::date, ${window.endsOn ?? null}::date,
          ${window.note?.trim() ?? null})`,
      { discard: true },
    );

  const insertTopics = (
    wantedSpeakerId: string,
    topics: ReadonlyArray<string>,
  ) =>
    Effect.forEach(
      [...new Set(topics)],
      (topic) => sql`
        INSERT INTO planning.wanted_speaker_topics (wanted_speaker_id, topic)
        VALUES (${wantedSpeakerId}, ${topic})
        ON CONFLICT DO NOTHING`,
      { discard: true },
    );

  const ideas = (where: { readonly id?: string; readonly status?: string }) =>
    sql`
      SELECT ${sql.literal(ideaJson)} AS row
      FROM planning.ideas i
      WHERE (${where.id ?? null}::uuid IS NULL OR i.id = ${where.id ?? null}::uuid)
        AND (${where.status ?? null}::text IS NULL OR i.status = ${where.status ?? null}::text)
      ORDER BY i.created_at, i.id`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Rows(Idea))),
      Effect.map((rows) => rows.map(({ row }) => row)),
    );

  const speakers = (where: {
    readonly id?: string;
    readonly status?: string;
    readonly topic?: string;
  }) =>
    sql`
      SELECT ${sql.literal(speakerJson)} AS row
      FROM planning.wanted_speakers w
      LEFT JOIN profiles p ON p.id = w.profile_id
      LEFT JOIN planning.contacts c ON c.id = w.contact_id
      WHERE (${where.id ?? null}::uuid IS NULL OR w.id = ${where.id ?? null}::uuid)
        AND (${where.status ?? null}::text IS NULL OR w.status = ${where.status ?? null}::text)
        AND (${where.topic ?? null}::text IS NULL OR EXISTS (
          SELECT 1 FROM planning.wanted_speaker_topics t
          WHERE t.wanted_speaker_id = w.id AND t.topic = ${where.topic ?? null}::text))
      ORDER BY lower(COALESCE(p.name, c.name)), w.id`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Rows(WantedSpeaker))),
      Effect.map((rows) => rows.map(({ row }) => row)),
    );

  const hosts = (where: { readonly id?: string; readonly status?: string }) =>
    Effect.gen(function* () {
      const now = DateTime.formatIso(yield* DateTime.now);
      // hostJson reads the time as $1, so this statement's parameters are
      // passed in that order.
      const rows = yield* sql.unsafe(
        `SELECT ${hostJson} AS row
        FROM planning.host_prospects h
        LEFT JOIN sponsors s ON s.id = h.sponsor_id
        LEFT JOIN planning.contacts c ON c.id = h.contact_id
        WHERE ($2::uuid IS NULL OR h.id = $2::uuid)
          AND ($3::text IS NULL OR h.status = $3::text)
        ORDER BY lower(COALESCE(s.name, h.company_name)), h.id`,
        [now, where.id ?? null, where.status ?? null],
      );
      const decoded = yield* Schema.decodeUnknownEffect(Rows(HostProspect))(
        rows,
      );
      return decoded.map(({ row }) => row);
    });

  const found = <A>(what: string, id: string, rows: ReadonlyArray<A>) => {
    const [row] = rows;
    return row === undefined
      ? refuse(`No ${what} has the id ${id}.`)
      : Effect.succeed(row);
  };

  const checkId = (what: string, id: string) =>
    isId(id) ? Effect.void : refuse(`No ${what} has the id ${id}.`);

  const addIdea = (idea: NewIdea) =>
    inTransaction(
      Effect.gen(function* () {
        const event =
          idea.eventSlug === undefined ? null : yield* eventId(idea.eventSlug);
        const inspiredBy =
          idea.inspiredBySlug === undefined
            ? null
            : yield* eventId(idea.inspiredBySlug);
        if ((idea.status ?? "idea") === "scheduled" && event === null) {
          return yield* refuse("A scheduled idea names its event (eventSlug).");
        }
        if (event !== null) yield* eventFree(event, undefined);
        const [row] = yield* sql`
          INSERT INTO planning.ideas (title, pitch, program, topic, status, event_id, inspired_by_event_id)
          VALUES (${idea.title.trim()}, ${idea.pitch.trim()}, ${idea.program},
            ${idea.topic ?? null}, ${idea.status ?? "idea"}, ${event}, ${inspiredBy})
          RETURNING id`.pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(IdRows)),
        );
        if (row === undefined)
          return yield* Effect.die("INSERT returned no id");
        if (event !== null) {
          yield* log({
            event: { id: event },
            command: "plan idea add",
            summary: `It became an idea's evening (${idea.program}, ${idea.status ?? "idea"}).`,
            payload: {
              ideaId: row.id,
              program: idea.program,
              topic: idea.topic ?? null,
              status: idea.status ?? "idea",
            },
          });
        }
        return yield* ideas({ id: row.id }).pipe(
          Effect.flatMap((rows) => found("idea", row.id, rows)),
        );
      }),
    );

  /** Refuses an event another idea already became. */
  const eventFree = (event: string, ideaId: string | undefined) =>
    sql`
      SELECT id FROM planning.ideas
      WHERE event_id = ${event} AND (${ideaId ?? null}::uuid IS NULL OR id <> ${ideaId ?? null}::uuid)`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(IdRows)),
      Effect.flatMap(([other]) =>
        other === undefined
          ? Effect.void
          : refuse(`That event is already idea ${other.id}'s.`),
      ),
    );

  const updateIdea = (id: string, changes: IdeaChanges) =>
    inTransaction(
      Effect.gen(function* () {
        yield* checkId("idea", id);
        const set: Record<string, unknown> = {};
        if (changes.title !== undefined) set["title"] = changes.title.trim();
        if (changes.pitch !== undefined) set["pitch"] = changes.pitch.trim();
        if (changes.program !== undefined) set["program"] = changes.program;
        if (changes.topic !== undefined) set["topic"] = changes.topic;
        if (changes.status !== undefined) set["status"] = changes.status;
        if (changes.eventSlug !== undefined) {
          const event =
            changes.eventSlug === null
              ? null
              : yield* eventId(changes.eventSlug);
          if (event !== null) yield* eventFree(event, id);
          set["event_id"] = event;
        }
        if (changes.inspiredBySlug !== undefined) {
          set["inspired_by_event_id"] =
            changes.inspiredBySlug === null
              ? null
              : yield* eventId(changes.inspiredBySlug);
        }
        if (Object.keys(set).length === 0) {
          return yield* refuse("Nothing to change.");
        }
        const [current] = yield* sql`
          SELECT status, event_id FROM planning.ideas WHERE id = ${id} FOR UPDATE`.pipe(
          Effect.flatMap(
            Schema.decodeUnknownEffect(
              Schema.Array(
                Schema.Struct({
                  status: Schema.String,
                  event_id: Schema.NullOr(Schema.String),
                }),
              ),
            ),
          ),
        );
        if (current === undefined) {
          return yield* refuse(`No idea has the id ${id}.`);
        }
        const status = changes.status ?? current.status;
        const event = "event_id" in set ? set["event_id"] : current.event_id;
        if (status === "scheduled" && event === null) {
          return yield* refuse("A scheduled idea names its event (eventSlug).");
        }
        yield* sql`
          UPDATE planning.ideas SET ${sql.update(set)}, updated_at = now()
          WHERE id = ${id}`;
        // Each evening the idea was or now is.
        const evenings = new Set(
          [current.event_id, event].filter(
            (value): value is string => typeof value === "string",
          ),
        );
        for (const evening of evenings) {
          yield* log({
            event: { id: evening },
            command: "plan idea update",
            summary:
              evening === event
                ? `Its idea changed: ${Object.keys(set).join(", ")}.`
                : "It is no longer this idea's evening.",
            payload: { ideaId: id, changed: Object.keys(set) },
          });
        }
        return yield* ideas({ id }).pipe(
          Effect.flatMap((rows) => found("idea", id, rows)),
        );
      }),
    );

  const listIdeas = (filter: { readonly status?: IdeaStatus } = {}) =>
    run(ideas(filter));

  const addWantedSpeaker = (ref: PersonRef, speaker: NewWantedSpeaker) =>
    inTransaction(
      Effect.gen(function* () {
        yield* checkWindows(speaker.availability ?? []);
        const { profileId, contactId } = yield* person(ref);
        const [existing] = yield* sql`
          SELECT id FROM planning.wanted_speakers
          WHERE profile_id = ${profileId} OR contact_id = ${contactId}`.pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(IdRows)),
        );
        if (existing !== undefined) {
          return yield* refuse(
            `Already wanted, as ${existing.id}; change them with speaker update.`,
          );
        }
        const [row] = yield* sql`
          INSERT INTO planning.wanted_speakers (profile_id, contact_id, status, note)
          VALUES (${profileId}, ${contactId}, ${speaker.status ?? "wanted"}, ${speaker.note?.trim() ?? null})
          RETURNING id`.pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(IdRows)),
        );
        if (row === undefined)
          return yield* Effect.die("INSERT returned no id");
        yield* insertTopics(row.id, speaker.topics);
        yield* insertWindows(row.id, speaker.availability ?? []);
        return yield* speakers({ id: row.id }).pipe(
          Effect.flatMap((rows) => found("wanted speaker", row.id, rows)),
        );
      }),
    );

  const updateWantedSpeaker = (id: string, changes: SpeakerChanges) =>
    inTransaction(
      Effect.gen(function* () {
        yield* checkId("wanted speaker", id);
        yield* checkWindows(changes.addAvailability ?? []);
        const set: Record<string, unknown> = {};
        if (changes.status !== undefined) set["status"] = changes.status;
        if (changes.note !== undefined) {
          set["note"] = changes.note === null ? null : changes.note.trim();
        }
        const changesSomething =
          Object.keys(set).length > 0 ||
          (changes.addTopics ?? []).length > 0 ||
          (changes.removeTopics ?? []).length > 0 ||
          (changes.addAvailability ?? []).length > 0 ||
          (changes.removeAvailability ?? []).length > 0;
        if (!changesSomething) return yield* refuse("Nothing to change.");
        const rows = yield* sql`
          SELECT id FROM planning.wanted_speakers WHERE id = ${id} FOR UPDATE`.pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(IdRows)),
        );
        yield* found("wanted speaker", id, rows);
        if (changes.removeAvailability !== undefined) {
          for (const window of changes.removeAvailability) {
            const removed = yield* sql`
              DELETE FROM planning.availability
              WHERE id = ${window} AND wanted_speaker_id = ${id}
              RETURNING id`.pipe(
              Effect.flatMap(Schema.decodeUnknownEffect(IdRows)),
            );
            if (removed.length === 0) {
              return yield* refuse(
                `Availability window ${window} isn't this speaker's.`,
              );
            }
          }
        }
        const removeTopics = [...new Set(changes.removeTopics ?? [])];
        if (removeTopics.length > 0) {
          const removed = yield* sql`
            DELETE FROM planning.wanted_speaker_topics
            WHERE wanted_speaker_id = ${id} AND topic IN ${sql.in(removeTopics)}
            RETURNING topic`.pipe(
            Effect.flatMap(
              Schema.decodeUnknownEffect(
                Schema.Array(Schema.Struct({ topic: Schema.String })),
              ),
            ),
          );
          const gone = new Set(removed.map((row) => row.topic));
          const missing = removeTopics.filter((topic) => !gone.has(topic));
          if (missing.length > 0) {
            return yield* refuse(
              `Not this speaker's topics: ${missing.join(", ")}.`,
            );
          }
        }
        yield* insertTopics(id, changes.addTopics ?? []);
        yield* insertWindows(id, changes.addAvailability ?? []);
        const [left] = yield* sql`
          SELECT count(*)::int AS count FROM planning.wanted_speaker_topics
          WHERE wanted_speaker_id = ${id}`.pipe(
          Effect.flatMap(
            Schema.decodeUnknownEffect(
              Schema.Array(Schema.Struct({ count: Schema.Number })),
            ),
          ),
        );
        if ((left?.count ?? 0) === 0) {
          return yield* refuse(
            "A wanted speaker keeps at least one topic: add one before removing the last.",
          );
        }
        yield* Object.keys(set).length > 0
          ? sql`UPDATE planning.wanted_speakers SET ${sql.update(set)}, updated_at = now() WHERE id = ${id}`
          : sql`UPDATE planning.wanted_speakers SET updated_at = now() WHERE id = ${id}`;
        return yield* speakers({ id }).pipe(
          Effect.flatMap((found_) => found("wanted speaker", id, found_)),
        );
      }),
    );

  const listWantedSpeakers = (filter: SpeakerFilter = {}) =>
    run(
      speakers({
        ...(filter.status === undefined ? {} : { status: filter.status }),
        ...(filter.topic === undefined ? {} : { topic: filter.topic }),
      }).pipe(
        Effect.map((rows) =>
          filter.availableOn === undefined
            ? rows
            : rows.filter((row) =>
                isAvailableOn(row.availability, filter.availableOn ?? ""),
              ),
        ),
      ),
    );

  const addHostProspect = (
    company: CompanyRef,
    contactRef: PersonRef | undefined,
    prospect: NewHostProspect,
  ) =>
    inTransaction(
      Effect.gen(function* () {
        let sponsorId: string | null = null;
        let companyName: string | null = null;
        if (company._tag === "Host") {
          sponsorId = (yield* host(company.ref)).id;
        } else {
          companyName = company.name.trim();
          if (companyName === "") return yield* refuse("A company has a name.");
          const known = yield* sql`
            SELECT id, name FROM sponsors WHERE lower(name) = lower(${companyName})`.pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(NamedRows)),
          );
          const [first] = known;
          if (first !== undefined) {
            return yield* refuse(
              `${first.name} is a hosting company we know (${first.id}): name it with sponsor.`,
            );
          }
        }
        if (contactRef?._tag === "Profile") {
          return yield* refuse(
            "A host prospect's contact is a contact: an existing one by id, or someone new.",
          );
        }
        const contactId =
          contactRef === undefined
            ? null
            : (yield* person(contactRef)).contactId;
        const [existing] = yield* sql`
          SELECT id FROM planning.host_prospects
          WHERE sponsor_id = ${sponsorId} OR lower(company_name) = lower(${companyName})`.pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(IdRows)),
        );
        if (existing !== undefined) {
          return yield* refuse(
            `Already a prospect, as ${existing.id}; change it with host update.`,
          );
        }
        const [row] = yield* sql`
          INSERT INTO planning.host_prospects (sponsor_id, company_name, contact_id, status, note)
          VALUES (${sponsorId}, ${companyName}, ${contactId}, ${prospect.status ?? "prospect"}, ${prospect.note?.trim() ?? null})
          RETURNING id`.pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(IdRows)),
        );
        if (row === undefined)
          return yield* Effect.die("INSERT returned no id");
        return yield* hosts({ id: row.id }).pipe(
          Effect.flatMap((rows) => found("host prospect", row.id, rows)),
        );
      }),
    );

  const updateHostProspect = (id: string, changes: HostChanges) =>
    inTransaction(
      Effect.gen(function* () {
        yield* checkId("host prospect", id);
        const set: Record<string, unknown> = {};
        if (changes.status !== undefined) set["status"] = changes.status;
        if (changes.note !== undefined) {
          set["note"] = changes.note === null ? null : changes.note.trim();
        }
        if (Object.keys(set).length === 0) {
          return yield* refuse("Nothing to change.");
        }
        const updated = yield* sql`
          UPDATE planning.host_prospects SET ${sql.update(set)}, updated_at = now()
          WHERE id = ${id} RETURNING id`.pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(IdRows)),
        );
        yield* found("host prospect", id, updated);
        return yield* hosts({ id }).pipe(
          Effect.flatMap((rows) => found("host prospect", id, rows)),
        );
      }),
    );

  const listHostProspects = (filter: { readonly status?: HostStatus } = {}) =>
    run(hosts(filter));

  const addNote = (subject: NoteSubject, body: string, author?: string) =>
    inTransaction(
      Effect.gen(function* () {
        const text = body.trim();
        if (text === "") return yield* refuse("A note says something.");
        const signed = author?.trim();
        if (signed === "") return yield* refuse("An author has a name.");
        const target =
          subject._tag === "Profile"
            ? { column: "profile_id", ...(yield* profile(subject.ref)) }
            : subject._tag === "Host"
              ? { column: "sponsor_id", ...(yield* host(subject.ref)) }
              : { column: "contact_id", ...(yield* contact(subject.id)) };
        const [row] = yield* sql`
          INSERT INTO planning.notes ${sql.insert({
            [target.column]: target.id,
            body: text,
            author: signed ?? null,
          })}
          RETURNING id`.pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(IdRows)),
        );
        if (row === undefined)
          return yield* Effect.die("INSERT returned no id");
        return { id: row.id, about: target.name, body: text };
      }),
    );

  const search = (query: string) =>
    Effect.gen(function* () {
      const text = query.trim();
      if (text === "") return yield* refuse("Search for something.");
      const pattern = containsPattern(text);
      const rows = yield* sql`
        WITH hits AS (
          SELECT 'idea' AS kind, i.id::text AS id, i.title AS label,
            concat_ws(' · ', i.title, i.topic, i.pitch) AS text
          FROM planning.ideas i
          UNION ALL
          SELECT 'wanted speaker', w.id::text, COALESCE(p.name, c.name),
            concat_ws(' · ', COALESCE(p.name, c.name),
              (SELECT string_agg(t.topic, ', ' ORDER BY t.topic) FROM planning.wanted_speaker_topics t WHERE t.wanted_speaker_id = w.id),
              w.note,
              (SELECT string_agg(a.note, '; ' ORDER BY a.starts_on NULLS FIRST, a.created_at, a.id) FROM planning.availability a WHERE a.wanted_speaker_id = w.id))
          FROM planning.wanted_speakers w
          LEFT JOIN profiles p ON p.id = w.profile_id
          LEFT JOIN planning.contacts c ON c.id = w.contact_id
          UNION ALL
          SELECT 'host prospect', h.id::text, COALESCE(s.name, h.company_name),
            concat_ws(' · ', COALESCE(s.name, h.company_name), h.note, c.name)
          FROM planning.host_prospects h
          LEFT JOIN sponsors s ON s.id = h.sponsor_id
          LEFT JOIN planning.contacts c ON c.id = h.contact_id
          UNION ALL
          SELECT 'contact', c.id::text, c.name,
            concat_ws(' · ', c.name, c.email, c.url, (SELECT s.name FROM sponsors s WHERE s.id = c.sponsor_id))
          FROM planning.contacts c
          UNION ALL
          SELECT 'note', n.id::text, COALESCE(p.name, s.name, c.name), n.body
          FROM planning.notes n
          LEFT JOIN profiles p ON p.id = n.profile_id
          LEFT JOIN sponsors s ON s.id = n.sponsor_id
          LEFT JOIN planning.contacts c ON c.id = n.contact_id
        )
        SELECT kind, id, label, text FROM hits
        WHERE text ILIKE ${pattern}
        ORDER BY kind, lower(label), id`;
      return yield* Schema.decodeUnknownEffect(Schema.Array(SearchHit))(rows);
    }).pipe(run);

  const DraftRows = Schema.Array(
    Schema.Struct({
      id: Schema.String,
      isDraft: Schema.Boolean,
      published: Schema.Boolean,
    }),
  );

  const readLineup = (draftId: string) =>
    sql`
      SELECT d.role, d.position, d.profile_id AS "profileId", p.name
      FROM planning.draft_people d JOIN profiles p ON p.id = d.profile_id
      WHERE d.event_id = ${draftId}
      ORDER BY array_position(ARRAY['organizer', 'co-host', 'mc'], d.role), d.position`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(DraftPersonRows)),
    );

  /**
   * The evening at `slug`, which must still be a draft. One being
   * published, or published on Luma (planning.publishes) before the sync
   * has caught up, has the public lineup.
   */
  const draftEvent = (slug: string) =>
    sql`
      SELECT e.id, e.is_draft AS "isDraft",
        EXISTS (SELECT 1 FROM planning.publishes pb
          WHERE pb.event_id = e.id) AS published
      FROM events e WHERE e.slug = ${slug}`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(DraftRows)),
      Effect.flatMap(([row]) =>
        row === undefined
          ? refuse(`No event, published or draft, has the slug "${slug}".`)
          : !row.isDraft || row.published
            ? refuse(
                `${slug} is published: its lineup is the public one (core/backfill/lineups.json).`,
              )
            : Effect.succeed(row.id),
      ),
    );

  const draftLineup = (slug: string) =>
    Effect.flatMap(draftEvent(slug), readLineup).pipe(run);

  const setDraftLineup: PlanningShape["setDraftLineup"] = (slug, people) =>
    inTransaction(
      Effect.gen(function* () {
        // Lock the evening first, so lineup changes to it go one at a time.
        yield* sql`SELECT id FROM events WHERE slug = ${slug} FOR UPDATE`;
        const draftId = yield* draftEvent(slug);
        const resolved = yield* Effect.forEach(people, (entry) =>
          Effect.map(profile(entry.profile), (named) => ({
            role: entry.role,
            profileId: named.id,
            name: named.name,
          })),
        );
        const seen = new Set<string>();
        for (const entry of resolved) {
          const key = `${entry.role} ${entry.profileId}`;
          if (seen.has(key)) {
            return yield* refuse(
              `${entry.name} is named twice as ${entry.role}.`,
            );
          }
          seen.add(key);
        }
        yield* sql`DELETE FROM planning.draft_people WHERE event_id = ${draftId}`;
        for (const role of roleOrder) {
          const inRole = resolved.filter((entry) => entry.role === role);
          for (const [position, entry] of inRole.entries()) {
            yield* sql`
              INSERT INTO planning.draft_people (event_id, profile_id, role, position)
              VALUES (${draftId}, ${entry.profileId}, ${role}, ${position})`;
          }
        }
        yield* log({
          event: { id: draftId },
          command: "plan lineup set",
          summary: `Its lineup is now ${
            resolved.length === 0
              ? "empty"
              : roleOrder
                  .map(
                    (role) =>
                      [
                        role,
                        resolved.filter((entry) => entry.role === role).length,
                      ] as const,
                  )
                  .filter(([, count]) => count > 0)
                  .map(([role, count]) => `${count} ${role}`)
                  .join(", ")
          }.`,
          payload: {
            lineup: resolved.map(({ role, profileId }) => ({
              role,
              profileId,
            })),
          },
        });
        return yield* readLineup(draftId);
      }),
    );

  const readTalks = (draftId: string) =>
    sql`
      SELECT t.id, t.position, t.kind, t.title, t.description,
        COALESCE((
          SELECT json_agg(json_build_object(
            'role', dp.role, 'position', dp.position,
            'wantedSpeakerId', w.id, 'name', COALESCE(p.name, c.name),
            'status', w.status, 'profileId', w.profile_id
          ) ORDER BY dp.position)
          FROM planning.draft_talk_people dp
          JOIN planning.wanted_speakers w ON w.id = dp.wanted_speaker_id
          LEFT JOIN profiles p ON p.id = w.profile_id
          LEFT JOIN planning.contacts c ON c.id = w.contact_id
          WHERE dp.draft_talk_id = t.id
        ), '[]'::json) AS people
      FROM planning.draft_talks t
      WHERE t.event_id = ${draftId}
      ORDER BY t.position`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(DraftTalkRows)),
    );

  const draftTalks = (slug: string) =>
    Effect.flatMap(draftEvent(slug), readTalks).pipe(run);

  /** The wanted speaker `id` names, or why it names none. */
  const wantedSpeaker = (id: string) =>
    Effect.gen(function* () {
      if (!isId(id)) {
        return yield* refuse(
          `"${id}" is not a wanted speaker's id: see bun run plan speaker list.`,
        );
      }
      const [row] = yield* sql`
        SELECT w.id, COALESCE(p.name, c.name) AS name, w.status
        FROM planning.wanted_speakers w
        LEFT JOIN profiles p ON p.id = w.profile_id
        LEFT JOIN planning.contacts c ON c.id = w.contact_id
        WHERE w.id = ${id}`.pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(WantedRows)),
      );
      return row === undefined
        ? yield* refuse(`No wanted speaker has the id ${id}.`)
        : row;
    });

  const addDraftTalk: PlanningShape["addDraftTalk"] = (slug, talk) =>
    inTransaction(
      Effect.gen(function* () {
        const title = talk.title.trim();
        // Counted as Postgres's char_length does: in code points.
        if (title === "" || Array.from(title).length > 120) {
          return yield* refuse("A talk's title is 1 to 120 characters.");
        }
        const description = talk.description?.trim();
        if (
          description !== undefined &&
          (description === "" || Array.from(description).length > 4000)
        ) {
          return yield* refuse(
            "A talk's description, if given, is 1 to 4000 characters.",
          );
        }
        const roles = draftTalkRoles[talk.kind];
        for (const entry of talk.people) {
          if (!roles.includes(entry.role)) {
            return yield* refuse(
              `A ${talk.kind} has no ${entry.role}: its people are ${roles.map((role) => `${role}s`).join(" and ")}.`,
            );
          }
        }
        if (
          talk.people.filter((entry) => entry.role === "moderator").length > 1
        ) {
          return yield* refuse(`A ${talk.kind} has one moderator.`);
        }
        // Lock the evening first, so changes to its talks go one at a time.
        yield* sql`SELECT id FROM events WHERE slug = ${slug} FOR UPDATE`;
        const draftId = yield* draftEvent(slug);
        // A talk is known on its evening by its title (readiness reads
        // them so), so no two share one, public or private.
        const [taken] = yield* sql`
          SELECT 1 AS taken FROM planning.draft_talks WHERE event_id = ${draftId} AND title = ${title}
          UNION ALL
          SELECT 1 FROM event_talks et JOIN talks t ON t.id = et.talk_id
          WHERE et.event_id = ${draftId} AND t.title = ${title}`;
        if (taken !== undefined) {
          return yield* refuse(`${slug} already has a talk called "${title}".`);
        }
        const people = yield* Effect.forEach(talk.people, (entry) =>
          Effect.map(wantedSpeaker(entry.wantedSpeaker), (wanted) => ({
            role: entry.role,
            wanted,
          })),
        );
        const seen = new Set<string>();
        for (const { wanted } of people) {
          if (seen.has(wanted.id)) {
            return yield* refuse(`${wanted.name} is named twice on the talk.`);
          }
          seen.add(wanted.id);
          if (wanted.status === "declined") {
            return yield* refuse(
              `${wanted.name} declined: change their status first if that's changed.`,
            );
          }
        }
        const [added] = yield* sql`
          INSERT INTO planning.draft_talks (event_id, position, kind, title, description)
          SELECT ${draftId}, COALESCE(max(position), 0) + 1, ${talk.kind}, ${title}, ${description ?? null}
          FROM planning.draft_talks WHERE event_id = ${draftId}
          RETURNING id`.pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(IdRows)),
        );
        if (added === undefined) {
          return yield* refuse(`The talk could not be added to ${slug}.`);
        }
        for (const [position, { role, wanted }] of people.entries()) {
          yield* sql`
            INSERT INTO planning.draft_talk_people (draft_talk_id, wanted_speaker_id, role, position)
            VALUES (${added.id}, ${wanted.id}, ${role}, ${position})`;
        }
        yield* log({
          event: { id: draftId },
          command: "plan lineup talk add",
          summary: `Added a ${talk.kind} with ${people.length} ${people.length === 1 ? "person" : "people"} on it.`,
          payload: {
            talkId: added.id,
            kind: talk.kind,
            people: people.map(({ role, wanted }) => ({
              role,
              wantedSpeakerId: wanted.id,
            })),
          },
        });
        return yield* readTalks(draftId);
      }),
    );

  const removeDraftTalk: PlanningShape["removeDraftTalk"] = (slug, id) =>
    inTransaction(
      Effect.gen(function* () {
        // Lock the evening first, so changes to its talks go one at a time.
        yield* sql`SELECT id FROM events WHERE slug = ${slug} FOR UPDATE`;
        const draftId = yield* draftEvent(slug);
        const [talk] = isId(id)
          ? yield* sql`
              SELECT id FROM planning.draft_talks
              WHERE id = ${id} AND event_id = ${draftId}`.pipe(
              Effect.flatMap(Schema.decodeUnknownEffect(IdRows)),
            )
          : [];
        if (talk === undefined) {
          return yield* refuse(
            `${slug} has no private talk with the id ${id}.`,
          );
        }
        yield* sql`DELETE FROM planning.draft_talk_people WHERE draft_talk_id = ${talk.id}`;
        yield* sql`DELETE FROM planning.draft_talks WHERE id = ${talk.id}`;
        yield* log({
          event: { id: draftId },
          command: "plan lineup talk remove",
          summary: "Removed a private talk.",
          payload: { talkId: talk.id },
        });
        return yield* readTalks(draftId);
      }),
    );

  return Planning.of({
    draftLineup,
    setDraftLineup,
    draftTalks,
    addDraftTalk,
    removeDraftTalk,
    addIdea,
    updateIdea,
    listIdeas,
    addWantedSpeaker,
    updateWantedSpeaker,
    listWantedSpeakers,
    addHostProspect,
    updateHostProspect,
    listHostProspects,
    addNote,
    search,
  });
});

export class Planning extends Context.Service<Planning, PlanningShape>()(
  "allthings/Planning",
) {
  static readonly layer = Layer.effect(Planning, make);
}
