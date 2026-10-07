import { Data, Effect } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { approvalToken, isApprovalToken } from "./approval.ts";

/**
 * Editing a talk that exists: its title, its description and its speakers
 * (scripts/talks.ts), exactly as a dry run showed it. The dry run prints
 * the change, every value as it is and as it will be, and an approval
 * token, the hash of that change. The approved run locks the talk, works
 * the change out again, and refuses it unless it still hashes to the token,
 * so anything that changed in between (a title, a speaker added elsewhere)
 * stops it.
 *
 * Speakers are the talk's whole list, in the order its page shows them
 * (`talk_speakers.created_at`), each a speaker or a moderator: a changed
 * list replaces the old one in `talk_speakers`, in the order given.
 */

export class TalkEditError extends Data.TaggedError("TalkEditError")<{
  readonly reason: string;
}> {
  override get message(): string {
    return this.reason;
  }
}

const fail = (reason: string) => Effect.fail(new TalkEditError({ reason }));

/** A speaker's part in a talk (`talk_speakers.role`). */
export type SpeakerRole = "speaker" | "moderator";

/** A speaker of a talk, as the change names them. */
export interface TalkSpeaker {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly role: SpeakerRole;
}

/** What to change; what is left out stays as it is. */
export interface TalkEdit {
  readonly title?: string;
  readonly description?: string;
  /** The whole list, in order: each profile's id or slug, and its part. */
  readonly speakers?: ReadonlyArray<{
    readonly profile: string;
    readonly role: SpeakerRole;
  }>;
}

/** A value as it is and as it will be; null where it doesn't change. */
export type Change<A> = { readonly from: A; readonly to: A } | null;

/** Editing a talk, as the database holds it now. */
export interface TalkChange {
  readonly talk: {
    readonly id: string;
    /** The evenings it is on, by slug. */
    readonly events: ReadonlyArray<string>;
  };
  readonly title: Change<string>;
  readonly description: Change<string>;
  readonly speakers: Change<ReadonlyArray<TalkSpeaker>>;
}

/** A change and its approval token, from a dry run. */
export interface PlannedTalkChange {
  readonly change: TalkChange;
  readonly token: string;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One of a talk's speakers, as read. */
interface SpeakerRow {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly role: SpeakerRole;
}

/** The talk's speakers, in the order its page shows them. */
const speakersOf = (talkId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    return yield* sql<SpeakerRow>`
      SELECT p.id::text AS id, p.name, p.slug, ts.role
      FROM talk_speakers ts
      JOIN profiles p ON p.id = ts.speaker_id
      WHERE ts.talk_id = ${talkId}::uuid
      ORDER BY ts.created_at, p.id`;
  });

/** The profile `profile` names: its id or its slug. */
const findSpeaker = (profile: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    const found = uuid.test(profile)
      ? yield* sql<Omit<SpeakerRow, "role">>`
          SELECT id::text AS id, name, slug FROM profiles
          WHERE id = ${profile.toLowerCase()}::uuid`
      : yield* sql<Omit<SpeakerRow, "role">>`
          SELECT id::text AS id, name, slug FROM profiles
          WHERE slug = ${profile}`;
    const person = found[0];
    if (person === undefined) {
      return yield* fail(
        `No profile is ${profile}: give a speaker's slug (as /people/<slug> has it) or id.`,
      );
    }
    return person;
  });

const same = (a: ReadonlyArray<TalkSpeaker>, b: ReadonlyArray<TalkSpeaker>) =>
  a.length === b.length &&
  a.every(
    (speaker, index) =>
      speaker.id === b[index]!.id && speaker.role === b[index]!.role,
  );

/**
 * Editing the talk `talkId` with `edit`, as the database holds it now.
 * Under `lock`, inside a transaction, the talk's row is locked first: a
 * speaker added to it elsewhere (its foreign key) waits for the lock.
 */
const talkChange = (talkId: string, edit: TalkEdit, lock: boolean) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    if (!uuid.test(talkId)) {
      return yield* fail(`${talkId} is not a talk's id.`);
    }
    const id = talkId.toLowerCase();
    if (
      edit.title === undefined &&
      edit.description === undefined &&
      edit.speakers === undefined
    ) {
      return yield* fail(
        "Nothing to change: give a new title, description or speakers.",
      );
    }
    const title = edit.title?.trim();
    if (title === "") return yield* fail("A talk's title can't be empty.");
    const description = edit.description?.trim();

    const talks = lock
      ? yield* sql<{ title: string; description: string }>`
          SELECT title, description FROM talks WHERE id = ${id}::uuid FOR UPDATE`
      : yield* sql<{ title: string; description: string }>`
          SELECT title, description FROM talks WHERE id = ${id}::uuid`;
    const talk = talks[0];
    if (talk === undefined) return yield* fail(`No talk has the id ${id}.`);
    const events = yield* sql<{ slug: string }>`
      SELECT e.slug FROM event_talks et JOIN events e ON e.id = et.event_id
      WHERE et.talk_id = ${id}::uuid ORDER BY e.start_date, e.slug`;

    let speakers: Change<ReadonlyArray<TalkSpeaker>> = null;
    if (edit.speakers !== undefined) {
      if (edit.speakers.length === 0) {
        return yield* fail("A talk needs at least one speaker.");
      }
      const to: Array<TalkSpeaker> = [];
      for (const { profile, role } of edit.speakers) {
        const person = yield* findSpeaker(profile);
        if (to.some((other) => other.id === person.id)) {
          return yield* fail(`${person.name} is named twice.`);
        }
        to.push({ ...person, role });
      }
      const from = yield* speakersOf(id);
      if (!same(from, to)) speakers = { from, to };
    }

    const change: TalkChange = {
      talk: { id, events: events.map((event) => event.slug) },
      title:
        title === undefined || title === talk.title
          ? null
          : { from: talk.title, to: title },
      description:
        description === undefined || description === talk.description
          ? null
          : { from: talk.description, to: description },
      speakers,
    };
    return change;
  });

/** Whether `change` changes anything. */
export const changesAnything = (change: TalkChange): boolean =>
  change.title !== null ||
  change.description !== null ||
  change.speakers !== null;

/**
 * What editing the talk `talkId` with `edit` would do, and the approval
 * token for exactly that. It only reads.
 */
export const planTalkEdit = (talkId: string, edit: TalkEdit) =>
  Effect.gen(function* () {
    const change = yield* talkChange(talkId, edit, false);
    const planned: PlannedTalkChange = {
      change,
      token: yield* approvalToken(change),
    };
    return planned;
  });

/**
 * Edits the talk `talkId` with `edit`, exactly as the dry run that printed
 * `token` showed: in one transaction, with the talk locked, the change is
 * worked out again and refused unless it hashes to `token`. A changed
 * speaker list replaces the old one, in the order given.
 */
export const editTalk = (talkId: string, edit: TalkEdit, token: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    if (!isApprovalToken(token)) {
      return yield* fail(
        `${token} is not an approval token: give the one talks update --dry-run printed.`,
      );
    }
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        const change = yield* talkChange(talkId, edit, true);
        const now = yield* approvalToken(change);
        if (now !== token) {
          return yield* fail(
            `The change has changed since ${token} was approved: it is now ${now}. Read it again with talks update --dry-run, and approve that.`,
          );
        }
        const id = change.talk.id;
        if (change.title !== null) {
          yield* sql`
            UPDATE talks SET title = ${change.title.to}, updated_at = now()
            WHERE id = ${id}::uuid`;
        }
        if (change.description !== null) {
          yield* sql`
            UPDATE talks SET description = ${change.description.to}, updated_at = now()
            WHERE id = ${id}::uuid`;
        }
        if (change.speakers !== null) {
          yield* sql`DELETE FROM talk_speakers WHERE talk_id = ${id}::uuid`;
          for (const [position, speaker] of change.speakers.to.entries()) {
            // One transaction has one now(); a millisecond apiece keeps the order given.
            yield* sql`
              INSERT INTO talk_speakers (talk_id, speaker_id, role, created_at, updated_at)
              VALUES (${id}::uuid, ${speaker.id}::uuid, ${speaker.role},
                now() + ${position} * interval '1 millisecond', now())`;
          }
        }
        return change;
      }),
    );
  });

/** The talks of the evening at `slug` (its long slug or its short link), in page order. */
export const listTalks = (slug: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    const events = yield* sql<{ id: string; slug: string }>`
      SELECT id::text AS id, slug FROM events
      WHERE slug = ${slug} OR short_slug = ${slug}
      ORDER BY short_slug = ${slug} DESC NULLS LAST
      LIMIT 1`;
    const event = events[0];
    if (event === undefined) return yield* fail(`No event at ${slug}.`);
    const talks = yield* sql<{ id: string; title: string; format: string }>`
      SELECT t.id::text AS id, t.title, t.format
      FROM event_talks et JOIN talks t ON t.id = et.talk_id
      WHERE et.event_id = ${event.id}::uuid
      ORDER BY et.position NULLS LAST, et.created_at, t.id`;
    const listed: Array<{
      readonly id: string;
      readonly title: string;
      readonly format: string;
      readonly speakers: ReadonlyArray<TalkSpeaker>;
    }> = [];
    for (const talk of talks) {
      listed.push({ ...talk, speakers: yield* speakersOf(talk.id) });
    }
    return { slug: event.slug, talks: listed };
  });

/**
 * The lines of `from` and `to`, as a diff: each line kept ("  "), taken
 * out ("- ") or put in ("+ "), in order.
 */
export function lineDiff(from: string, to: string): ReadonlyArray<string> {
  const a = from === "" ? [] : from.split("\n");
  const b = to === "" ? [] : to.split("\n");
  // The longest common subsequence's length from each pair of positions on.
  const longest = Array.from({ length: a.length + 1 }, () =>
    Array.from({ length: b.length + 1 }, () => 0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      longest[i]![j] =
        a[i] === b[j]
          ? longest[i + 1]![j + 1]! + 1
          : Math.max(longest[i + 1]![j]!, longest[i]![j + 1]!);
    }
  }
  const lines: Array<string> = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      lines.push(`  ${a[i]}`);
      i++;
      j++;
    } else if (
      i < a.length &&
      (j === b.length || longest[i + 1]![j]! >= longest[i]![j + 1]!)
    ) {
      // What is taken out comes before what is put in its place.
      lines.push(`- ${a[i]}`);
      i++;
    } else {
      lines.push(`+ ${b[j]}`);
      j++;
    }
  }
  return lines;
}

const speakerLine = (speaker: TalkSpeaker) =>
  `${speaker.name} (${speaker.slug}, ${speaker.role})`;

/** A change in lines: each value as it is and as it will be. */
export const changeLines = (change: TalkChange): ReadonlyArray<string> => [
  `talk ${change.talk.id}, on ${change.talk.events.length === 0 ? "no evening" : change.talk.events.join(", ")}`,
  ...(change.title === null
    ? ["title: unchanged"]
    : [
        "title:",
        `- ${JSON.stringify(change.title.from)}`,
        `+ ${JSON.stringify(change.title.to)}`,
      ]),
  ...(change.description === null
    ? ["description: unchanged"]
    : [
        "description:",
        ...lineDiff(change.description.from, change.description.to),
      ]),
  ...(change.speakers === null
    ? ["speakers: unchanged"]
    : [
        "speakers, in order:",
        ...lineDiff(
          change.speakers.from.map(speakerLine).join("\n"),
          change.speakers.to.map(speakerLine).join("\n"),
        ),
      ]),
];
