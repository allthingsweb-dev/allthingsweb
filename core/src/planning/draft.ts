import { Context, Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";
import { DataSourceError } from "../errors.ts";
import { collabTables } from "../collab/collab.ts";
import { Readiness } from "../readiness/readiness.ts";
import {
  ActorRequired,
  currentActor,
  type DraftLogEntry,
  logDraft,
} from "./draft-log.ts";
import { draftRoleOrder, PlanningError } from "./planning.ts";
import { readsEveryRow } from "./privacy.ts";

/**
 * A draft evening's notes, decisions and questions, and its status in one
 * read (README, "A draft's log, notes and status";
 * migrations/0028_draft_log.ts). `bun run plan note` and `plan status`
 * (scripts/plan.ts) and the admin MCP server's draft tools run through
 * here.
 *
 * A note is written once, as ALLTHINGS_ACTOR, with its line in the draft's
 * log in the same transaction; only an open question is ever changed, to
 * resolve it. Its text is the organizers' own: the log says what kind was
 * added and its id, never the text.
 */

type Failure = PlanningError | DataSourceError;

const refuse = (reason: string) => Effect.fail(new PlanningError({ reason }));

export const NoteKind = Schema.Literals(["note", "decision", "question"]);
export type NoteKind = typeof NoteKind.Type;

/** An instant, as the database prints it in UTC. */
const iso = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;

export const DraftNote = Schema.Struct({
  id: Schema.String,
  at: Schema.String,
  actor: Schema.String,
  kind: NoteKind,
  text: Schema.String,
  resolvedAt: Schema.NullOr(Schema.String),
});
export type DraftNote = typeof DraftNote.Type;

export const LogEntry = Schema.Struct({
  id: Schema.String,
  at: Schema.String,
  actor: Schema.String,
  command: Schema.String,
  summary: Schema.String,
  payload: Schema.Record(Schema.String, Schema.Unknown),
});
export type LogEntry = typeof LogEntry.Type;

const Facts = Schema.Struct({
  id: Schema.String,
  slug: Schema.String,
  name: Schema.String,
  isDraft: Schema.Boolean,
  lumaEventId: Schema.NullOr(Schema.String),
  startDate: Schema.String,
  endDate: Schema.String,
  shortLocation: Schema.NullOr(Schema.String),
  streetAddress: Schema.NullOr(Schema.String),
  fullAddress: Schema.NullOr(Schema.String),
  generatedCoverUrl: Schema.NullOr(Schema.String),
  publish: Schema.NullOr(
    Schema.Struct({
      status: Schema.String,
      claimedAt: Schema.String,
      publishedAt: Schema.NullOr(Schema.String),
    }),
  ),
  lineup: Schema.Array(
    Schema.Struct({
      role: Schema.String,
      position: Schema.Int,
      name: Schema.String,
    }),
  ),
  talks: Schema.Array(
    Schema.Struct({
      position: Schema.Int,
      kind: Schema.String,
      title: Schema.String,
      people: Schema.Array(
        Schema.Struct({
          role: Schema.String,
          name: Schema.String,
          status: Schema.String,
          hasProfile: Schema.Boolean,
        }),
      ),
    }),
  ),
});

const Collab = Schema.Struct({
  rounds: Schema.Array(
    Schema.Struct({
      position: Schema.Int,
      title: Schema.String,
      hosts: Schema.Int,
      handedIn: Schema.Boolean,
    }),
  ),
  invites: Schema.Record(Schema.String, Schema.Int),
  submissions: Schema.Int,
});

/** Everything `plan status` says about one draft, from one read. */
export interface DraftStatus {
  readonly event: {
    readonly slug: string;
    readonly name: string;
    /** Private on Luma while a draft; its publish, once claimed. */
    readonly luma: {
      readonly eventId: string | null;
      readonly visibility: "private" | "public" | "not on Luma";
      readonly publish: typeof Facts.Type.publish;
    };
    readonly startDate: string;
    readonly endDate: string;
    readonly venue: {
      readonly name: string | null;
      readonly street: string | null;
      readonly full: string | null;
    } | null;
    readonly program: string;
    /** Ours and saying what its facts say now, drawn for facts since changed, not ours, or none set. */
    readonly cover: "current" | "stale" | "not ours" | "none";
  };
  readonly readiness: {
    readonly ready: boolean;
    readonly blockers: ReadonlyArray<{
      readonly kind: string;
      readonly message: string;
    }>;
    readonly advice: ReadonlyArray<{
      readonly kind: string;
      readonly message: string;
    }>;
    readonly collaboration: "read" | "not readable as this role";
  };
  readonly lineup: typeof Facts.Type.lineup;
  readonly talks: typeof Facts.Type.talks;
  /** The companies we'd like to host, with where we are with each. */
  readonly wantedHosts: ReadonlyArray<{
    readonly name: string;
    readonly status: string;
  }>;
  readonly collab:
    | (typeof Collab.Type & { readonly readable: true })
    | {
        readonly readable: false;
      };
  readonly notes: {
    readonly openQuestions: ReadonlyArray<DraftNote>;
    readonly decisions: ReadonlyArray<DraftNote>;
    readonly notes: ReadonlyArray<DraftNote>;
    readonly resolvedQuestions: number;
  };
  /** The last 20 entries of its log, newest first. */
  readonly log: ReadonlyArray<LogEntry>;
}

export interface DraftsShape {
  /** Adds a note, a decision or a question to the evening at `slug`. */
  readonly addNote: (
    slug: string,
    kind: NoteKind,
    text: string,
  ) => Effect.Effect<DraftNote, Failure>;
  /** Resolves the open question `id`. */
  readonly resolveNote: (id: string) => Effect.Effect<DraftNote, Failure>;
  /** The draft at `slug`, all of it, in one read. */
  readonly status: (slug: string) => Effect.Effect<DraftStatus, Failure>;
}

const isId = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

const make = Effect.gen(function* () {
  const sql = yield* SqlClient;
  const readiness = yield* Readiness;

  const run = <A>(
    effect: Effect.Effect<
      A,
      | PlanningError
      | DataSourceError
      | SqlError
      | Schema.SchemaError
      | ActorRequired
    >,
  ): Effect.Effect<A, Failure> =>
    effect.pipe(
      Effect.catchTag(["SqlError", "SchemaError"], (cause) =>
        Effect.fail(new DataSourceError({ cause })),
      ),
      Effect.catchTag("ActorRequired", (missing) => refuse(missing.reason)),
    );

  const log = (entry: DraftLogEntry) =>
    logDraft(entry).pipe(Effect.provideService(SqlClient, sql));

  const decode =
    <S extends Schema.Top>(schema: S) =>
    (rows: unknown) =>
      Schema.decodeUnknownEffect(Schema.Array(schema))(rows);

  const noteColumns = sql.unsafe(
    `id, ${iso("at")} AS at, actor, kind, text, CASE WHEN resolved_at IS NULL THEN NULL ELSE ${iso("resolved_at")} END AS "resolvedAt"`,
  );

  const addNote: DraftsShape["addNote"] = (slug, kind, text) =>
    run(
      Effect.andThen(
        currentActor,
        sql.withTransaction(
          Effect.gen(function* () {
            const actor = yield* currentActor;
            const body = text.trim();
            // Counted as char_length is: in code points.
            if (body === "" || Array.from(body).length > 2000) {
              return yield* refuse(`A ${kind} is 1 to 2000 characters.`);
            }
            const [evening] = yield* sql`
              SELECT id FROM events WHERE slug = ${slug}`.pipe(
              Effect.flatMap(decode(Schema.Struct({ id: Schema.String }))),
            );
            if (evening === undefined) {
              return yield* refuse(
                `No event, published or draft, has the slug "${slug}".`,
              );
            }
            const [note] = yield* sql`
              INSERT INTO planning.draft_notes (event_id, actor, kind, text)
              VALUES (${evening.id}, ${actor}, ${kind}, ${body})
              RETURNING ${noteColumns}`.pipe(Effect.flatMap(decode(DraftNote)));
            if (note === undefined) return yield* Effect.die("no note");
            yield* log({
              event: { id: evening.id },
              command: "plan note",
              summary: `Added a ${kind}.`,
              payload: { noteId: note.id, kind },
            });
            return note;
          }),
        ),
      ),
    );

  const resolveNote: DraftsShape["resolveNote"] = (id) =>
    run(
      Effect.andThen(
        currentActor,
        sql.withTransaction(
          Effect.gen(function* () {
            if (!isId(id)) return yield* refuse(`"${id}" is not a note's id.`);
            const [current] = yield* sql`
              SELECT event_id AS "eventId", kind, resolved_at IS NOT NULL AS resolved
              FROM planning.draft_notes WHERE id = ${id} FOR UPDATE`.pipe(
              Effect.flatMap(
                decode(
                  Schema.Struct({
                    eventId: Schema.String,
                    kind: NoteKind,
                    resolved: Schema.Boolean,
                  }),
                ),
              ),
            );
            if (current === undefined) {
              return yield* refuse(`No note has the id ${id}.`);
            }
            if (current.kind !== "question") {
              return yield* refuse(
                `${id} is a ${current.kind}: only a question is resolved, and a ${current.kind} is written once.`,
              );
            }
            if (current.resolved) {
              return yield* refuse(`The question ${id} is already resolved.`);
            }
            const [note] = yield* sql`
              UPDATE planning.draft_notes SET resolved_at = greatest(now(), at)
              WHERE id = ${id}
              RETURNING ${noteColumns}`.pipe(Effect.flatMap(decode(DraftNote)));
            if (note === undefined) return yield* Effect.die("no note");
            yield* log({
              event: { id: current.eventId },
              command: "plan note resolve",
              summary: "Resolved a question.",
              payload: { noteId: id },
            });
            return note;
          }),
        ),
      ),
    );

  const facts = (slug: string) =>
    sql`
      SELECT e.id, e.slug, e.name, e.is_draft AS "isDraft",
        e.luma_event_id AS "lumaEventId",
        ${sql.unsafe(iso("e.start_date"))} AS "startDate",
        ${sql.unsafe(iso("e.end_date"))} AS "endDate",
        e.short_location AS "shortLocation", e.street_address AS "streetAddress",
        e.full_address AS "fullAddress",
        e.generated_cover_url AS "generatedCoverUrl",
        (SELECT json_build_object('status', pb.status,
            'claimedAt', ${sql.unsafe(iso("pb.claimed_at"))},
            'publishedAt', CASE WHEN pb.published_at IS NULL THEN NULL ELSE ${sql.unsafe(iso("pb.published_at"))} END)
          FROM planning.publishes pb WHERE pb.event_id = e.id) AS publish,
        COALESCE((SELECT json_agg(json_build_object('role', d.role, 'position', d.position, 'name', p.name)
            ORDER BY d.position)
          FROM planning.draft_people d JOIN profiles p ON p.id = d.profile_id
          WHERE d.event_id = e.id), '[]'::json) AS lineup,
        COALESCE((SELECT json_agg(json_build_object('position', t.position, 'kind', t.kind, 'title', t.title,
            'people', COALESCE((SELECT json_agg(json_build_object('role', dp.role,
                'name', COALESCE(pr.name, c.name), 'status', w.status,
                'hasProfile', w.profile_id IS NOT NULL) ORDER BY dp.position)
              FROM planning.draft_talk_people dp
              JOIN planning.wanted_speakers w ON w.id = dp.wanted_speaker_id
              LEFT JOIN profiles pr ON pr.id = w.profile_id
              LEFT JOIN planning.contacts c ON c.id = w.contact_id
              WHERE dp.draft_talk_id = t.id), '[]'::json)) ORDER BY t.position)
          FROM planning.draft_talks t WHERE t.event_id = e.id), '[]'::json) AS talks
      FROM events e WHERE e.slug = ${slug}`.pipe(Effect.flatMap(decode(Facts)));

  const collab = (eventId: string) =>
    sql`
      SELECT
        COALESCE((SELECT json_agg(json_build_object('position', r.position, 'title', r.title,
            'hosts', (SELECT count(*) FROM planning.collaborators c
              WHERE c.round_id = r.id AND c.revoked_at IS NULL AND c.expires_at > now()),
            'handedIn', EXISTS (SELECT 1 FROM planning.round_submissions s
              WHERE s.round_id = r.id AND s.stage = 'final')) ORDER BY r.position)
          FROM planning.rounds r WHERE r.event_id = ${eventId}), '[]'::json) AS rounds,
        COALESCE((SELECT json_object_agg(role, n) FROM (
          SELECT c.role, count(*)::int AS n FROM planning.collaborators c
          WHERE c.event_id = ${eventId} AND c.revoked_at IS NULL AND c.expires_at > now()
          GROUP BY c.role) active), '{}'::json) AS invites,
        (SELECT count(*)::int FROM planning.round_submissions s WHERE s.event_id = ${eventId}) AS submissions`.pipe(
      Effect.flatMap(decode(Collab)),
    );

  const notesOf = (eventId: string) =>
    sql`SELECT ${noteColumns} FROM planning.draft_notes
        WHERE event_id = ${eventId} ORDER BY at, id`.pipe(
      Effect.flatMap(decode(DraftNote)),
    );

  const logOf = (eventId: string) =>
    sql`
      SELECT id, ${sql.unsafe(iso("at"))} AS at, actor, command, summary, payload
      FROM planning.draft_log WHERE event_id = ${eventId}
      ORDER BY at DESC, id DESC LIMIT 20`.pipe(
      Effect.flatMap(decode(LogEntry)),
    );

  const status: DraftsShape["status"] = (slug) =>
    run(
      Effect.gen(function* () {
        const [fact] = yield* facts(slug);
        if (fact === undefined) {
          return yield* refuse(
            `No event, published or draft, has the slug "${slug}".`,
          );
        }
        const report = yield* readiness.report({ _tag: "Event", slug });
        const kinds = new Set(report.checks.map((check) => check.kind));
        const readable = yield* readsEveryRow(collabTables).pipe(
          Effect.provideService(SqlClient, sql),
        );
        const [together] = readable ? yield* collab(fact.id) : [];
        const notes = yield* notesOf(fact.id);
        const brief = (check: (typeof report.checks)[number]) => ({
          kind: check.kind,
          message: check.message,
        });
        return {
          event: {
            slug: fact.slug,
            name: fact.name,
            luma: {
              eventId: fact.lumaEventId,
              visibility:
                fact.lumaEventId === null
                  ? "not on Luma"
                  : fact.isDraft
                    ? "private"
                    : "public",
              publish: fact.publish,
            },
            startDate: fact.startDate,
            endDate: fact.endDate,
            venue:
              fact.shortLocation === null &&
              fact.streetAddress === null &&
              fact.fullAddress === null
                ? null
                : {
                    name: fact.shortLocation,
                    street: fact.streetAddress,
                    full: fact.fullAddress,
                  },
            program:
              report.subject.kind === "event"
                ? report.subject.program
                : "talks",
            cover: kinds.has("own-cover")
              ? "not ours"
              : kinds.has("cover-facts")
                ? "stale"
                : fact.generatedCoverUrl === null
                  ? "none"
                  : "current",
          },
          readiness: {
            ready: report.ready,
            blockers: report.checks
              .filter((check) => check.level === "blocker")
              .map(brief),
            advice: report.checks
              .filter((check) => check.level !== "blocker")
              .map(brief),
            collaboration: report.collaboration,
          },
          // By role, as planning lists a lineup, then by position.
          lineup: fact.lineup.toSorted(
            (a, b) =>
              draftRoleOrder.indexOf(
                a.role as (typeof draftRoleOrder)[number],
              ) -
              draftRoleOrder.indexOf(b.role as (typeof draftRoleOrder)[number]),
          ),
          talks: fact.talks,
          wantedHosts: report.suggestions.hosts.prospects.map((prospect) => ({
            name: prospect.name,
            status: prospect.status,
          })),
          collab:
            together === undefined
              ? { readable: false as const }
              : { readable: true as const, ...together },
          notes: {
            openQuestions: notes.filter(
              (note) => note.kind === "question" && note.resolvedAt === null,
            ),
            decisions: notes.filter((note) => note.kind === "decision"),
            notes: notes.filter((note) => note.kind === "note"),
            resolvedQuestions: notes.filter(
              (note) => note.kind === "question" && note.resolvedAt !== null,
            ).length,
          },
          log: yield* logOf(fact.id),
        } satisfies DraftStatus;
      }),
    );

  return Drafts.of({ addNote, resolveNote, status });
});

export class Drafts extends Context.Service<Drafts, DraftsShape>()(
  "allthings/Drafts",
) {
  /** Needs `Readiness` and a `SqlClient`. */
  static readonly layer = Layer.effect(Drafts, make);
}

/** A note, one line: its kind, id, who and when, and its text. */
export const formatNote = (note: DraftNote): string =>
  `${note.kind} ${note.id} · ${note.actor} · ${note.at}${note.resolvedAt === null ? "" : ` · resolved ${note.resolvedAt}`}\n  ${note.text.replaceAll("\n", "\n  ")}`;

/** `plan status`, as text. */
export function formatStatus(status: DraftStatus): string {
  const { event } = status;
  const lines = [
    `${event.name} (${event.slug})`,
    `luma: ${event.luma.visibility}${event.luma.eventId === null ? "" : ` ${event.luma.eventId}`}${
      event.luma.publish === null
        ? ""
        : ` · publish ${event.luma.publish.status} since ${event.luma.publish.publishedAt ?? event.luma.publish.claimedAt}`
    }`,
    `when: ${event.startDate} to ${event.endDate}`,
    `venue: ${
      event.venue === null
        ? "none yet"
        : [event.venue.name, event.venue.full ?? event.venue.street]
            .filter((part) => part !== null)
            .join(", ")
    }`,
    `program: ${event.program}`,
    `cover: ${event.cover}`,
    "",
    `readiness: ${status.readiness.ready ? "ready" : `${status.readiness.blockers.length} blocking`}, ${status.readiness.advice.length} advice${
      status.readiness.collaboration === "read"
        ? ""
        : " (collaboration not readable as this role)"
    }`,
    ...status.readiness.blockers.map((check) => `  ✗ ${check.message}`),
    "",
    status.lineup.length === 0
      ? "lineup: none yet"
      : `lineup: ${status.lineup.map((person) => `${person.name} (${person.role})`).join(", ")}`,
    ...status.talks.map(
      (talk) =>
        `talk ${talk.position}, ${talk.kind}: ${talk.title}${
          talk.people.length === 0
            ? " · nobody on it yet"
            : ` · ${talk.people.map((person) => `${person.name} (${person.role}, ${person.status}${person.hasProfile ? "" : ", no profile"})`).join(", ")}`
        }`,
    ),
    status.wantedHosts.length === 0
      ? "wanted hosts: none"
      : `wanted hosts: ${status.wantedHosts.map((host) => `${host.name} (${host.status})`).join(", ")}`,
    status.collab.readable
      ? `collab: ${status.collab.rounds.length} rounds (${status.collab.rounds
          .map(
            (round) =>
              `${round.position} ${round.title}: ${round.hosts} host${round.hosts === 1 ? "" : "s"}${round.handedIn ? ", handed in" : ""}`,
          )
          .join("; ")}), invites ${
          Object.entries(status.collab.invites)
            .map(([role, count]) => `${count} ${role}`)
            .join(", ") || "none"
        }, ${status.collab.submissions} submissions`
      : "collab: not readable as this role (row security): run collab as the owner",
    "",
    `open questions: ${status.notes.openQuestions.length}, decisions: ${status.notes.decisions.length}, notes: ${status.notes.notes.length}, resolved questions: ${status.notes.resolvedQuestions}`,
    ...[
      ...status.notes.openQuestions,
      ...status.notes.decisions,
      ...status.notes.notes,
    ].map(formatNote),
    "",
    `log (last ${status.log.length}):`,
    ...status.log.map(
      (entry) =>
        `  ${entry.at} ${entry.actor} · ${entry.command}: ${entry.summary}`,
    ),
  ];
  return lines.join("\n");
}
