import { Effect, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { talkAppearances } from "./catalog.ts";
import { asOf } from "./clock.ts";
import type { Now } from "./now.ts";
import { isStale } from "./now.ts";
import type { PeopleFile } from "./people-enrichment.ts";
import { orDataSourceError } from "./sql.ts";

/**
 * Which "now" records are due for another look (docs/now.md,
 * "Refreshing"), for an agent to research and rewrite under the rules: the
 * records in core/backfill/people.json checked `days` or more days ago, and
 * optionally everyone who has spoken at one of our evenings and has none.
 * Someone whose `now` is null asked to be left off, so is never listed.
 */

/** One person to look at again, with what they have now. */
export interface Due {
  readonly profileId: string;
  readonly name: string;
  /** Why: the record is old, or there is none yet. */
  readonly reason: "stale" | "none";
  readonly now: Now | null;
  /** Unconfirmed claims kept from earlier looks, so they aren't chased twice. */
  readonly held: ReadonlyArray<{
    readonly value: string | null;
    readonly reason: string;
  }>;
}

/** The file's records checked `days` or more days before `today` (YYYY-MM-DD), oldest first. */
export const staleRecords = (
  file: PeopleFile,
  today: string,
  days: number,
): ReadonlyArray<Due> =>
  file
    .flatMap((entry) =>
      entry.now === undefined ||
      entry.now === null ||
      !isStale(entry.now.checkedOn, today, days)
        ? []
        : [
            {
              profileId: entry.profileId,
              name: entry.name,
              reason: "stale" as const,
              now: entry.now,
              held: heldNow(entry),
            },
          ],
    )
    .toSorted(
      (a, b) =>
        (a.now?.checkedOn ?? "").localeCompare(b.now?.checkedOn ?? "") ||
        a.name.localeCompare(b.name),
    );

const heldNow = (entry: PeopleFile[number]) =>
  (entry.held ?? [])
    .filter((held) => held.field === "now")
    .map((held) => ({ value: held.value, reason: held.reason }));

const Speaker = Schema.Struct({ id: Schema.String, name: Schema.String });

/**
 * Everyone who spoke at one of our evenings that has ended, by name, whose
 * file entry has no `now` key at all: never researched. A `now` of null
 * (taken down) or a record keeps them off this list.
 */
export const speakersWithoutNow = (file: PeopleFile) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    const now = yield* asOf;
    const rows = yield* sql`
      SELECT DISTINCT p.id::text AS id, p.name
      FROM ${talkAppearances(sql, { whose: "ours", when: { ended: now } })} a
      JOIN profiles p ON p.id = a.profile_id
      ORDER BY p.name, id`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Speaker))),
      orDataSourceError,
    );
    const entries = new Map(file.map((entry) => [entry.profileId, entry]));
    return rows.flatMap((row): ReadonlyArray<Due> => {
      const entry = entries.get(row.id);
      if (entry?.now !== undefined) return [];
      return [
        {
          profileId: row.id,
          name: row.name,
          reason: "none",
          now: null,
          held: entry === undefined ? [] : heldNow(entry),
        },
      ];
    });
  });
