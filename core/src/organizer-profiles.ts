import { Context, Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { ahead, ours } from "./catalog.ts";
import { asOf } from "./clock.ts";
import { decodePeopleFile, type PeopleFile } from "./people-enrichment.ts";
import { sfDay } from "./readiness/calendar.ts";
import { orDataSourceError } from "./sql.ts";

/**
 * Whether the people hosting an evening have profiles someone checked
 * lately. An organizer's or co-host's title and bio are what everyone
 * reads about them before the evening (the site, Luma, the promotion), so
 * an old one shows to the people we invite before we notice it: an outside
 * organizer once read Erik's stale bio before we did (2026-11).
 *
 * The record of checks is core/backfill/people.json, where every fact has
 * the day it was read (src/people-enrichment.ts). A host's profile is
 * fresh when their entry there has a title and a bio each read in the last
 * {@link organizerCheckDays} days; with either missing, or older, it is
 * stale. Re-reading a title or bio that is still right is still a check:
 * the entry's `read` moves, and `bun run people` changes nothing.
 *
 * Readiness blocks a draft whose organizer or co-host is stale
 * (src/readiness/checks.ts, "organizer-profile"); `bun run people stale
 * --organizers` lists the hosts of every evening of ours ahead.
 */

/** How old a host's checked title and bio may be, in days. */
export const organizerCheckDays = 90;

/** The parts that host an evening: whose profile it is about. */
export const hostingRoles = ["organizer", "co-host"] as const;

/**
 * Whether `read` (YYYY-MM-DD) is a real day from 0 up to `days` days
 * before `today`. A day ahead (a typo'd year) or no real day at all
 * isn't a check: a gate fails closed on a bad date.
 */
const readWithin = (read: string, today: string, days: number): boolean => {
  const at = Date.parse(`${read}T00:00:00Z`);
  if (Number.isNaN(at) || new Date(at).toISOString().slice(0, 10) !== read) {
    return false;
  }
  const age = (Date.parse(`${today}T00:00:00Z`) - at) / 86_400_000;
  return age >= 0 && age < days;
};

/** When a host's title and bio were last read in the file, and whether that's recent enough. */
export interface ProfileCheck {
  readonly fresh: boolean;
  /** The day each was read, or null when the file has no fact for it. */
  readonly title: string | null;
  readonly bio: string | null;
}

/** `profileId`'s check in `file` on `today` (YYYY-MM-DD). */
export const profileCheck = (
  file: PeopleFile,
  profileId: string,
  today: string,
  days: number = organizerCheckDays,
): ProfileCheck => {
  const entry = file.find((candidate) => candidate.profileId === profileId);
  const title = entry?.title?.read ?? null;
  const bio = entry?.bio?.read ?? null;
  return {
    fresh:
      title !== null &&
      bio !== null &&
      readWithin(title, today, days) &&
      readWithin(bio, today, days),
    title,
    bio,
  };
};

/** What a stale check says: which of the two is missing or old, and since when. */
export const staleLine = (check: ProfileCheck): string =>
  (["title", "bio"] as const)
    .map((field) =>
      check[field] === null
        ? `${field} never checked`
        : `${field} read ${check[field]}`,
    )
    .join(", ");

/** The reviewed record of checks, core/backfill/people.json, as readiness reads it. */
export class PeopleRecord extends Context.Service<
  PeopleRecord,
  { readonly file: PeopleFile }
>()("allthings/PeopleRecord") {
  /** The repository's file, read once. It is part of the code, so a file that won't decode is a defect. */
  static readonly layer = Layer.effect(
    PeopleRecord,
    Effect.tryPromise(() =>
      Bun.file(new URL("../backfill/people.json", import.meta.url)).text(),
    ).pipe(
      Effect.flatMap(decodePeopleFile),
      Effect.map((file) => PeopleRecord.of({ file })),
      Effect.orDie,
    ),
  );

  /** A record of `file`'s checks, for a test or another file. */
  static readonly fromFile = (file: PeopleFile) =>
    Layer.succeed(PeopleRecord, PeopleRecord.of({ file }));
}

/** One host of an evening ahead whose profile is stale, with the evenings they host. */
export interface StaleHost {
  readonly profileId: string;
  readonly name: string;
  readonly title: string | null;
  readonly bio: string | null;
  readonly evenings: ReadonlyArray<string>;
}

const HostRow = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  slug: Schema.String,
});

/**
 * Everyone who organizes or co-hosts an evening of ours not over yet,
 * draft or published, whose profile `file` hasn't checked lately, by name;
 * each with the evenings, by slug. A draft's lineup is kept in planning
 * until it is published (planning.draft_people), so it joins as a role that
 * may read planning (the studio, or the owner); site_reader sees the
 * published lineups only. Returns them with `today`, San Francisco's day
 * they were judged by (readiness's): a `read` dated after it isn't a check.
 */
export const staleHosts = (file: PeopleFile, days = organizerCheckDays) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    const now = yield* asOf;
    // San Francisco's day, as readiness judges the same draft by.
    const today = sfDay(now);
    const [planning] = yield* sql<{ readable: boolean }>`
      SELECT EXISTS (
        SELECT 1 FROM pg_catalog.pg_namespace n
        WHERE n.nspname = 'planning' AND pg_catalog.has_schema_privilege(n.oid, 'USAGE')
      ) AS readable`.pipe(orDataSourceError);
    const lineups = planning?.readable
      ? sql`SELECT event_id, profile_id, role FROM event_people
          UNION SELECT event_id, profile_id, role FROM planning.draft_people`
      : sql`SELECT event_id, profile_id, role FROM event_people`;
    const rows = yield* sql`
      SELECT DISTINCT p.id::text AS id, p.name, e.slug
      FROM (${lineups}) ep
      JOIN events e ON e.id = ep.event_id
      JOIN profiles p ON p.id = ep.profile_id
      WHERE ${ours(sql, "e")} AND ${ahead(sql, "e", now)}
        AND ep.role IN ${sql.in([...hostingRoles])}
      ORDER BY p.name, id, e.slug`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(HostRow))),
      orDataSourceError,
    );
    const hosts = new Map<string, StaleHost & { evenings: Array<string> }>();
    for (const row of rows) {
      const check = profileCheck(file, row.id, today, days);
      if (check.fresh) continue;
      const host = hosts.get(row.id) ?? {
        profileId: row.id,
        name: row.name,
        title: check.title,
        bio: check.bio,
        evenings: [],
      };
      host.evenings.push(row.slug);
      hosts.set(row.id, host);
    }
    // The day it judged by, so whoever records a check can date it so.
    return { today, hosts: [...hosts.values()] as ReadonlyArray<StaleHost> };
  });
