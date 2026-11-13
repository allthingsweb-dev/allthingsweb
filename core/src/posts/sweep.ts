import { DateTime, Effect, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { published } from "../catalog.ts";
import { orDataSourceError } from "../sql.ts";
import {
  type CandidateReport,
  findCandidates,
  windowAfter,
  windowBefore,
} from "./candidates.ts";
import { type PendingPost, pendingPosts } from "./review.ts";

/**
 * A sweep: what the agent running an evening runs, again and again, from
 * two weeks before it to a week after, to keep its page's posts live. It
 * searches for posts about that one evening (findCandidates, the same
 * searches and scores), adds those that score enough as pending, and says
 * what is new and what waits for review. Running it again adds nothing it
 * added before: a post is stored once, whatever its status.
 */

/** No published evening has this slug or short link. */
export class SweepEveningNotFound extends Schema.TaggedError<SweepEveningNotFound>()(
  "SweepEveningNotFound",
  { slug: Schema.String },
) {
  override get message(): string {
    return `No published evening has the slug or short link "${this.slug}"`;
  }
}

const Evening = Schema.Struct({
  slug: Schema.String,
  startDate: Schema.DateTimeUtcFromDate,
  endDate: Schema.DateTimeUtcFromDate,
});

/** The days a post may be about the evening, and so the days to sweep. */
export interface SweepWindow {
  readonly since: DateTime.Utc;
  readonly until: DateTime.Utc;
}

export interface SweepReport {
  /** The evening's long slug, as `posts add` and `posts pending` take it. */
  readonly slug: string;
  readonly window: SweepWindow;
  /** Per platform: how many posts its search found, or why it found none. */
  readonly searched: CandidateReport["searched"];
  /** Added by this sweep (or, in a dry run, that would be). */
  readonly added: CandidateReport["candidates"];
  /** Found again: already stored, or left for a later run, with why. */
  readonly known: CandidateReport["candidates"];
  /** The evening's posts waiting for review, earliest first. */
  readonly waiting: ReadonlyArray<PendingPost>;
}

/** The published evening at `slug` (long slug or short link), and its window. */
export const sweepWindow = (slug: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    const rows = yield* sql`
      SELECT e.slug, e.start_date AS "startDate", e.end_date AS "endDate"
      FROM events e
      WHERE ${published(sql, "e")} AND (e.slug = ${slug} OR e.id IN (
        SELECT event_id FROM event_slugs WHERE slug = ${slug}))`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Evening))),
      orDataSourceError,
    );
    const [row] = rows;
    if (row === undefined) return yield* new SweepEveningNotFound({ slug });
    return {
      slug: row.slug,
      window: {
        since: DateTime.subtractDuration(row.startDate, windowBefore),
        until: DateTime.addDuration(row.endDate, windowAfter),
      },
    };
  });

/** Sweeps the evening at `slug` once. A dry run writes nothing. */
export const sweep = (slug: string, options: { readonly dryRun: boolean }) =>
  Effect.gen(function* () {
    const evening = yield* sweepWindow(slug);
    const [report] = yield* findCandidates({
      scope: { _tag: "Slugs", slugs: [evening.slug] },
      dryRun: options.dryRun,
    });
    const candidates = report?.candidates ?? [];
    // Added here, or under another evening its post is about.
    const isNew = (outcome: string) =>
      /^(for \S+: )?(added|would add)$/.test(outcome);
    const waiting = yield* pendingPosts(evening.slug);
    return {
      slug: evening.slug,
      window: evening.window,
      searched: report?.searched ?? {},
      added: candidates.filter((c) => isNew(c.outcome)),
      known: candidates.filter((c) => !isNew(c.outcome)),
      waiting,
    } satisfies SweepReport;
  });
