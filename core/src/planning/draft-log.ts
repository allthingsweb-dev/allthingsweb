import { Config, Effect, Option, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";

/**
 * A draft evening's log (migrations/0028_draft_log.ts): every studio write
 * that touches a draft evening appends one entry, as part of the write's
 * own transaction, so the entry and the write are kept or rolled back
 * together, and a dry run leaves neither.
 *
 * Who wrote is ALLTHINGS_ACTOR (`erik`, `andre`, `erik/claude-work`): a
 * label the person or agent running the command declares, not proof of
 * who they are. Every studio write refuses to run without one; reads never
 * ask. Per-person database roles would make it proof, if that's ever
 * needed.
 *
 * An entry never holds a secret or a contact detail: its payload is built
 * from ids, names of things and the values a command set, never an email,
 * which the table's CHECK refuses anyway.
 */

/** ALLTHINGS_ACTOR's shape, as the tables check it. */
export const actorPattern =
  /^[a-z0-9][a-z0-9._-]{0,31}(\/[a-z0-9][a-z0-9._-]{0,31})?$/;

/** A studio write was asked for without a usable ALLTHINGS_ACTOR; nothing was written. */
export class ActorRequired extends Schema.TaggedError<ActorRequired>()(
  "ActorRequired",
  { reason: Schema.String },
) {
  override get message(): string {
    return this.reason;
  }
}

/**
 * Who is writing: ALLTHINGS_ACTOR, checked. Every studio write asks for it
 * before it writes anything, Luma and the platforms included.
 */
export const currentActor: Effect.Effect<string, ActorRequired> = Effect.gen(
  function* () {
    const actor = yield* Config.option(Config.String("ALLTHINGS_ACTOR")).pipe(
      Effect.mapError(
        () =>
          new ActorRequired({ reason: "ALLTHINGS_ACTOR couldn't be read." }),
      ),
    );
    if (Option.isNone(actor)) {
      return yield* new ActorRequired({
        reason:
          "Studio writes say who is writing: set ALLTHINGS_ACTOR (like erik, andre or erik/claude-work) and run it again. Nothing was written.",
      });
    }
    if (!actorPattern.test(actor.value)) {
      return yield* new ActorRequired({
        reason: `ALLTHINGS_ACTOR "${actor.value}" isn't a label: lowercase letters, digits, . _ -, and at most one / (like erik/claude-work). Nothing was written.`,
      });
    }
    return actor.value;
  },
);

/** Which evening an entry is about: by id, slug or Luma id, as the write knows it. */
export type DraftRef =
  | { readonly id: string }
  | { readonly slug: string }
  | { readonly lumaEventId: string };

/** One entry, as a write describes itself. */
export interface DraftLogEntry {
  readonly event: DraftRef;
  /** The command, as its CLI names it: `plan lineup set`, `collab invite`. */
  readonly command: string;
  /** One line a person reads: what changed. */
  readonly summary: string;
  /** What changed, as JSON: ids and values set, never a secret or an email. */
  readonly payload?: Readonly<Record<string, unknown>>;
}

/**
 * Appends `entry` to its evening's log, as ALLTHINGS_ACTOR, on the
 * caller's connection: inside the caller's transaction, it commits or
 * rolls back with the write. An evening the database doesn't hold (a Luma
 * event never stored) gets no entry.
 */
export const logDraft = (entry: DraftLogEntry) =>
  Effect.gen(function* () {
    const actor = yield* currentActor;
    const sql = yield* SqlClient;
    const where =
      "id" in entry.event
        ? sql`id = ${entry.event.id}::uuid`
        : "slug" in entry.event
          ? sql`slug = ${entry.event.slug}`
          : sql`luma_event_id = ${entry.event.lumaEventId}`;
    yield* sql`
      INSERT INTO planning.draft_log (event_id, actor, command, summary, payload)
      SELECT id, ${actor}, ${entry.command}, ${entry.summary},
        ${JSON.stringify(entry.payload ?? {})}::jsonb
      FROM events WHERE ${where}`;
  });

/** `effect` and its log entry, in one transaction: both kept, or neither. */
export const withDraftLog =
  <A>(entry: (result: A) => DraftLogEntry) =>
  <E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient;
      // Asked first, so a missing actor writes nothing at all.
      yield* currentActor;
      return yield* sql.withTransaction(
        Effect.tap(effect, (result) => logDraft(entry(result))),
      );
    });

/**
 * For a write that goes to Luma first, where no transaction can hold both:
 * the actor, asked before anything is sent, as `refuse`'s refusal.
 */
export const actorFor = <E>(
  refuse: (reason: string) => Effect.Effect<never, E>,
) =>
  currentActor.pipe(
    Effect.catchTag("ActorRequired", (missing) => refuse(missing.reason)),
  );

/**
 * The log entry of a write Luma has taken, appended once Luma has: a
 * failure here says Luma has it and the log doesn't, as `refuse`'s refusal.
 */
export const logAfterLuma = <E>(
  entry: DraftLogEntry,
  refuse: (reason: string) => Effect.Effect<never, E>,
) =>
  logDraft(entry).pipe(
    Effect.catch((failure) =>
      refuse(
        `Luma has it, but its line in the draft's log wasn't written (${failure instanceof Error ? failure.message : String(failure)}).`,
      ),
    ),
  );
