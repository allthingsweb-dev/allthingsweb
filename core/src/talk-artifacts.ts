import { Effect, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import type * as Statement from "effect/sql/Statement";
import { HttpUrl } from "./contract.ts";
import { DataSourceError } from "./errors.ts";

/**
 * What a talk left behind (`talk_artifacts`, migrations/0040): its
 * recording, its slides, its code, its site. Each is one link, so the
 * recorder in the room, a speaker sharing their slides and a sourced
 * backfill each add rows, never columns.
 *
 * The backfill (core/backfill/talk-artifacts.json, `bun run
 * talk-artifacts`) carries links someone found, each with the URL that
 * confirms it and the day it was read; what only looks right is kept under
 * `held` with the question that would settle it, and never written.
 *
 * Every surface reads a talk's links with the catalog's `artifactsOf` and
 * {@link artifactJson}, and shows them through {@link talkLinks}, so the
 * talk's own recording is the same one everywhere.
 */

export const artifactKinds = [
  "recording",
  "slides",
  "repo",
  "site",
  "other",
] as const;
export type ArtifactKind = (typeof artifactKinds)[number];

/** An https URL with a domain-name host, as the public contract accepts, and no whitespace. */
const Url = HttpUrl.check(
  Schema.isPattern(/^https:\/\/\S+$/),
  Schema.isMaxLength(2000),
);

/** A day on the calendar, YYYY-MM-DD: never a February 30th. */
const Day = Schema.String.check(
  Schema.makeFilter((value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "expected a YYYY-MM-DD day";
    const day = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(day.getTime()) &&
      day.toISOString().slice(0, 10) === value
      ? undefined
      : `${value} is not a day on the calendar`;
  }),
);

/** Text with something in it, no surrounding space, as the table insists. */
const Text = (max: number) =>
  Schema.String.check(
    Schema.isNonEmpty(),
    Schema.isMaxLength(max),
    Schema.makeFilter((value: string) =>
      value.trim() === value ? undefined : "expected no surrounding space",
    ),
  );

const TalkId = Schema.String.check(
  Schema.isPattern(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  ),
);

export const ArtifactEntry = Schema.Struct({
  /** The talk, and its title as stored, which must still match. */
  talkId: TalkId,
  title: Text(500),
  kind: Schema.Literals(artifactKinds),
  url: Url,
  /** What the link is, where its kind doesn't say enough. */
  label: Schema.optionalKey(Text(120)),
  /** Where the talk starts in a recording of the whole evening. */
  startSeconds: Schema.optionalKey(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  ),
  /**
   * Where the same talk was given, when this comes from there and not
   * from our evening: "Chain React 2024".
   */
  elsewhere: Schema.optionalKey(Text(120)),
  /** The page that confirms it: names the talk, or our evening, and the speaker. */
  source: Url,
  read: Day,
  /** What the source alone doesn't say. Kept in the file, never written. */
  note: Schema.optionalKey(Text(1000)),
});
export type ArtifactEntry = typeof ArtifactEntry.Type;

export const TalkArtifactsFile = Schema.Struct({
  /** Confirmed links, each talk's in the order its links are shown. */
  artifacts: Schema.Array(ArtifactEntry),
  /** Links found but not confirmed, each with the question that would settle it. */
  held: Schema.Array(
    Schema.Struct({
      talkId: TalkId,
      title: Text(500),
      kind: Schema.Literals(artifactKinds),
      url: Url,
      question: Text(1000),
    }),
  ),
});
export type TalkArtifactsFile = typeof TalkArtifactsFile.Type;

/**
 * The file's JSON text, decoded strictly: a field the schema doesn't know
 * fails the run instead of being dropped.
 */
export const decodeTalkArtifactsFile = Schema.decodeUnknownEffect(
  Schema.fromJsonString(TalkArtifactsFile),
  { onExcessProperty: "error" },
);

/** A file that cannot be applied as written; nothing was written. */
export class TalkArtifactsError extends Schema.TaggedError<TalkArtifactsError>()(
  "TalkArtifactsError",
  { reason: Schema.String },
) {
  override get message(): string {
    return this.reason;
  }
}

class RolledBack extends Schema.TaggedError<RolledBack>()("RolledBack", {
  lines: Schema.Array(Schema.String),
}) {}

/** A recording of the talk itself, from our evening: the one its title links to. */
const isOwnRecording = (entry: {
  readonly kind: ArtifactKind;
  readonly elsewhere?: string | null | undefined;
}) => entry.kind === "recording" && (entry.elsewhere ?? null) === null;

/**
 * What is wrong with `file` before anything is read: a link listed twice
 * for a talk, a start in something that isn't a recording, or two
 * recordings of a talk's own. Empty when it may be applied.
 */
export function fileProblems(file: TalkArtifactsFile): ReadonlyArray<string> {
  const problems: Array<string> = [];
  const seen = new Set<string>();
  const own = new Set<string>();
  for (const entry of file.artifacts) {
    const key = `${entry.talkId} ${entry.url}`;
    if (seen.has(key)) {
      problems.push(`"${entry.title}" lists ${entry.url} more than once.`);
    }
    seen.add(key);
    if (entry.startSeconds !== undefined && entry.kind !== "recording") {
      problems.push(
        `"${entry.title}": ${entry.url} has a start but is a ${entry.kind}, not a recording.`,
      );
    }
    if (isOwnRecording(entry)) {
      if (own.has(entry.talkId)) {
        problems.push(
          `"${entry.title}" has more than one recording of its own; mark the others with where they were given (elsewhere).`,
        );
      }
      own.add(entry.talkId);
    }
  }
  return problems;
}

/**
 * Writes `file`'s links in one transaction. A link new to its talk is
 * added; one already there (by its URL) takes the file's kind, label,
 * start, place, position and source where they differ. A talk's links
 * take the positions of their order in the file, from 0. Links from other
 * sources are kept as they are. With `dryRun`, rolls it back after doing
 * everything. Fails, writing nothing, on a problem {@link fileProblems}
 * finds, a talk that isn't stored or whose title no longer matches, or a
 * talk that would end with two recordings of its own.
 */
export const applyTalkArtifacts = (file: TalkArtifactsFile, dryRun: boolean) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    const fail = (reason: string) =>
      Effect.fail(new TalkArtifactsError({ reason }));

    const problems = fileProblems(file);
    if (problems.length > 0) return yield* fail(problems.join("\n"));

    const work = Effect.gen(function* () {
      const lines: Array<string> = file.held.map(
        (held) => `held: "${held.title}": ${held.kind} ${held.url}`,
      );
      const titles = new Map<string, string>();
      const positions = new Map<string, number>();
      for (const entry of file.artifacts) {
        if (!titles.has(entry.talkId)) {
          const rows = yield* sql<{ title: string }>`
            SELECT title FROM talks WHERE id = ${entry.talkId}::uuid`;
          const [row] = rows;
          if (row === undefined) {
            return yield* fail(`No talk has the id ${entry.talkId}.`);
          }
          titles.set(entry.talkId, row.title);
        }
        if (titles.get(entry.talkId) !== entry.title) {
          return yield* fail(
            `Talk ${entry.talkId} is titled "${titles.get(entry.talkId) ?? ""}", not "${entry.title}".`,
          );
        }
        const position = positions.get(entry.talkId) ?? 0;
        positions.set(entry.talkId, position + 1);
        const written = yield* sql<{ added: boolean }>`
          INSERT INTO talk_artifacts (talk_id, kind, url, label, start_seconds,
            elsewhere, position, source_url, read_on, updated_at)
          VALUES (${entry.talkId}::uuid, ${entry.kind}, ${entry.url},
            ${entry.label ?? null}, ${entry.startSeconds ?? null},
            ${entry.elsewhere ?? null}, ${position}, ${entry.source},
            ${entry.read}::date, now())
          ON CONFLICT (talk_id, url) DO UPDATE SET
            kind = excluded.kind, label = excluded.label,
            start_seconds = excluded.start_seconds,
            elsewhere = excluded.elsewhere, position = excluded.position,
            source_url = excluded.source_url, read_on = excluded.read_on,
            updated_at = excluded.updated_at
          WHERE (talk_artifacts.kind, talk_artifacts.label,
              talk_artifacts.start_seconds, talk_artifacts.elsewhere,
              talk_artifacts.position, talk_artifacts.source_url)
            IS DISTINCT FROM (excluded.kind, excluded.label,
              excluded.start_seconds, excluded.elsewhere, excluded.position,
              excluded.source_url)
          RETURNING (xmax = 0) AS added`;
        const [outcome] = written;
        lines.push(
          `"${entry.title}": ${entry.kind} ${entry.url}: ${
            outcome === undefined
              ? "already there"
              : outcome.added
                ? "added"
                : "updated"
          }`,
        );
      }
      const talkIds = [...titles.keys()];
      const twice =
        talkIds.length === 0
          ? []
          : yield* sql<{ title: string }>`
              SELECT t.title FROM talk_artifacts a
              JOIN talks t ON t.id = a.talk_id
              WHERE a.talk_id IN ${sql.in(talkIds)}
                AND a.kind = 'recording' AND a.elsewhere IS NULL
              GROUP BY t.id, t.title
              HAVING count(*) > 1
              ORDER BY t.title`;
      if (twice.length > 0) {
        return yield* fail(
          `These talks would have more than one recording of their own: ${twice.map((row) => `"${row.title}"`).join(", ")}.`,
        );
      }
      if (dryRun) return yield* new RolledBack({ lines });
      return lines;
    });

    return yield* sql.withTransaction(work).pipe(
      Effect.catchTag("RolledBack", (rolledBack) =>
        Effect.succeed([...rolledBack.lines, "Dry run: rolled back."]),
      ),
      Effect.catchTag("SqlError", (cause) =>
        Effect.fail(new DataSourceError({ cause })),
      ),
    );
  });

/**
 * A talk's link as every surface reads it, over `a` (talk_artifacts), for
 * the catalog's `artifactsOf`.
 */
export const artifactJson = (sql: SqlClient): Statement.Fragment =>
  sql`json_build_object('kind', a.kind, 'url', a.url, 'label', a.label,
    'startSeconds', a.start_seconds, 'elsewhere', a.elsewhere)`;

/** A talk's link, as {@link artifactJson} reads it. */
export const ArtifactRow = Schema.Struct({
  kind: Schema.Literals(artifactKinds),
  url: Schema.String,
  label: Schema.NullOr(Schema.String),
  startSeconds: Schema.NullOr(Schema.Int),
  elsewhere: Schema.NullOr(Schema.String),
});
export type ArtifactRow = typeof ArtifactRow.Type;

/** The talk's own recording: where to watch it from its start. */
export interface TalkRecording {
  /** The recording, at the talk's start where it has one. */
  readonly url: string;
  /** Where the talk starts in it, in seconds; null when it starts at 0 or isn't known. */
  readonly startSeconds: number | null;
}

/** One of a talk's other links, as surfaces show it. */
export interface TalkArtifact {
  readonly kind: ArtifactKind;
  readonly url: string;
  readonly label: string | null;
  /** Where the same talk was given, when the link comes from there. */
  readonly elsewhere: string | null;
}

/** A talk's links: its own recording, and everything else in order. */
export interface TalkLinks {
  readonly recording: TalkRecording | null;
  readonly artifacts: ReadonlyArray<TalkArtifact>;
}

/**
 * `url` played from `seconds` in: YouTube's `t` parameter, Vimeo's `#t=`;
 * any other host's address as it is, which plays from the start.
 */
export function playAt(url: string, seconds: number | null): string {
  if (seconds === null || seconds === 0) return url;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  const host = parsed.hostname.replace(/^(www|m)\./, "");
  if (host === "youtube.com" || host === "youtu.be") {
    parsed.searchParams.set("t", String(seconds));
    return parsed.toString();
  }
  if (host === "vimeo.com") {
    parsed.hash = `t=${seconds}s`;
    return parsed.toString();
  }
  return url;
}

/**
 * A talk's links from its rows, in their order: its first recording from
 * our evening is its own, played from the talk's start; everything else,
 * recordings of the same talk elsewhere included, follows in order.
 */
export function talkLinks(rows: ReadonlyArray<ArtifactRow>): TalkLinks {
  const own = rows.find(isOwnRecording);
  return {
    recording:
      own === undefined
        ? null
        : {
            url: playAt(own.url, own.startSeconds),
            startSeconds:
              own.startSeconds === null || own.startSeconds === 0
                ? null
                : own.startSeconds,
          },
    artifacts: rows
      .filter((row) => row !== own)
      .map((row) => ({
        kind: row.kind,
        url: row.url,
        label: row.label,
        elsewhere: row.elsewhere,
      })),
  };
}
