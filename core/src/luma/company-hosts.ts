import {
  Context,
  DateTime,
  Duration,
  Effect,
  Layer,
  Option,
  Schema,
} from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import type { DataSourceError } from "../errors.ts";
import { orDataSourceError } from "../sql.ts";
import { LumaApi, type LumaApiError, type LumaEventPeople } from "./api.ts";

/**
 * Attaches the hosting companies Luma lists as an evening's hosts, in the
 * hourly sync, so an evening's page names them ("Hosted at …") without
 * waiting for an organizer to run the people import (src/luma/people-sync.ts).
 *
 * A host is a hosting company only when its Luma account is one we have on
 * record (`sponsors.luma_user_id`, from backfill/hosts.json), exactly as the
 * people import decides it (src/luma/people.ts). An account we have no
 * record of, as a company or as a person (`profiles.luma_user_id`), is
 * reported, never made into a company: Luma doesn't say which accounts are
 * companies.
 *
 * Who owns what: this only adds `event_sponsors` rows, as the people import
 * does. A company an organizer attached stays, and so does one Luma stops
 * listing. People, profiles and guest counts stay the people import's.
 *
 * Only published evenings with a Luma id that haven't ended more than
 * `within` ago are asked about: Luma's hosts change while an evening is
 * planned, and the people import covers the rest. All of Luma's answers are
 * read before the database is written, in one statement. Without
 * LUMA_API_KEY it does nothing.
 */

/** Events asked about at once, far under the API's 200 requests a minute. */
export const concurrency = 4;

/** A hosting company with its Luma account on record. */
export interface RecordedCompany {
  readonly id: string;
  readonly name: string;
  readonly lumaUserId: string;
}

/** An evening the step asks Luma about. */
export interface AskedEvening {
  readonly eventId: string;
  readonly slug: string;
  readonly lumaEventId: string;
}

/** A hosting company to attach to an evening. */
export interface CompanyAttachment {
  readonly eventId: string;
  readonly slug: string;
  readonly companyId: string;
  readonly company: string;
}

/** A host of an evening whose Luma account we have no record of. */
export interface UnknownHost {
  readonly slug: string;
  readonly lumaUserId: string;
  readonly name: string | null;
}

export interface CompanyHostsPlan {
  /** Companies Luma lists that aren't attached yet, in Luma's order. */
  readonly attach: ReadonlyArray<CompanyAttachment>;
  readonly unknown: ReadonlyArray<UnknownHost>;
}

/**
 * What the step does with Luma's answers: no reads, no writes. `attached`
 * holds the evening and company of each row already in event_sponsors, as
 * `${eventId} ${companyId}`; `people` the Luma accounts profiles hold.
 */
export function planCompanyHosts(
  answers: ReadonlyArray<{
    readonly evening: AskedEvening;
    readonly people: LumaEventPeople;
  }>,
  companies: ReadonlyArray<RecordedCompany>,
  people: ReadonlySet<string>,
  attached: ReadonlySet<string>,
): CompanyHostsPlan {
  const companyOf = new Map(
    companies.map((company) => [company.lumaUserId, company] as const),
  );
  const attach: Array<CompanyAttachment> = [];
  const unknown: Array<UnknownHost> = [];
  for (const { evening, people: luma } of answers) {
    const seen = new Set<string>();
    for (const host of luma.hosts) {
      if (seen.has(host.lumaUserId)) continue;
      seen.add(host.lumaUserId);
      const company = companyOf.get(host.lumaUserId);
      if (company === undefined) {
        if (!people.has(host.lumaUserId)) {
          unknown.push({
            slug: evening.slug,
            lumaUserId: host.lumaUserId,
            name: host.name,
          });
        }
        continue;
      }
      if (attached.has(`${evening.eventId} ${company.id}`)) continue;
      attach.push({
        eventId: evening.eventId,
        slug: evening.slug,
        companyId: company.id,
        company: company.name,
      });
    }
  }
  return { attach, unknown };
}

export type CompanyHostsRun =
  | { readonly _tag: "Skipped"; readonly reason: string }
  | {
      readonly _tag: "Planned";
      /** Evenings asked about. */
      readonly asked: number;
      readonly plan: CompanyHostsPlan;
      /** Of those, the Luma ids of events Luma does not show us. */
      readonly unavailable: ReadonlyArray<string>;
      /** Rows written; null for a dry run. */
      readonly written: number | null;
    };

export interface CompanyHostsOptions {
  /** Plan only: ask Luma, write nothing. */
  readonly dryRun: boolean;
  /** Evenings that ended longer ago than this aren't asked about. */
  readonly within: Duration.Input;
  /** Ask about at most this many evenings, the latest to start first. */
  readonly maxEvents?: number;
}

export interface LumaCompanyHostsShape {
  /** Asks Luma and, unless `dryRun`, attaches the companies it lists, all or nothing. */
  readonly run: (
    options: CompanyHostsOptions,
  ) => Effect.Effect<CompanyHostsRun, LumaApiError | DataSourceError>;
}

const Stored = Schema.Struct({
  evenings: Schema.Array(
    Schema.Struct({
      eventId: Schema.String,
      slug: Schema.String,
      lumaEventId: Schema.String,
    }),
  ),
  companies: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      lumaUserId: Schema.String,
    }),
  ),
  people: Schema.Array(Schema.String),
  attached: Schema.Array(Schema.String),
});

const Written = Schema.Struct({ written: Schema.Int });

const make = Effect.gen(function* () {
  const api = yield* LumaApi;
  const sql = yield* SqlClient;

  const read = (since: DateTime.Utc, maxEvents: number | null) =>
    sql`
      WITH evenings AS (
        SELECT e.id, e.slug, e.luma_event_id, e.start_date
        FROM events e
        WHERE e.is_draft = false AND e.luma_event_id IS NOT NULL
          AND e.end_date >= ${DateTime.formatIso(since)}::timestamptz
        ORDER BY e.start_date DESC, e.id
        LIMIT ${maxEvents}
      )
      SELECT
        COALESCE((
          SELECT json_agg(json_build_object('eventId', v.id, 'slug', v.slug,
            'lumaEventId', v.luma_event_id) ORDER BY v.start_date DESC, v.id)
          FROM evenings v
        ), '[]'::json) AS evenings,
        COALESCE((
          SELECT json_agg(json_build_object('id', s.id, 'name', s.name,
            'lumaUserId', s.luma_user_id) ORDER BY s.id)
          FROM sponsors s WHERE s.luma_user_id IS NOT NULL
        ), '[]'::json) AS companies,
        COALESCE((
          SELECT json_agg(p.luma_user_id ORDER BY p.luma_user_id)
          FROM profiles p WHERE p.luma_user_id IS NOT NULL
        ), '[]'::json) AS people,
        COALESCE((
          SELECT json_agg(es.event_id || ' ' || es.sponsor_id)
          FROM event_sponsors es WHERE es.event_id IN (SELECT id FROM evenings)
        ), '[]'::json) AS attached`.pipe(
      Effect.flatMap(([row]) => Schema.decodeUnknownEffect(Stored)(row)),
      orDataSourceError,
    );

  const write = (
    attach: ReadonlyArray<CompanyAttachment>,
    now: DateTime.Utc,
  ) => {
    const rows = JSON.stringify(
      attach.map((row) => ({
        event_id: row.eventId,
        sponsor_id: row.companyId,
      })),
    );
    const at = DateTime.formatIso(now);
    // Only adds: a row attached meanwhile (by the people import, say) is
    // left as it is.
    return sql`
      WITH written AS (
        INSERT INTO event_sponsors (event_id, sponsor_id, created_at, updated_at)
        SELECT h.event_id, h.sponsor_id, ${at}::timestamptz, ${at}::timestamptz
        FROM jsonb_to_recordset(${rows}::jsonb) AS h(event_id uuid, sponsor_id uuid)
        ON CONFLICT (event_id, sponsor_id) DO NOTHING
        RETURNING 1
      )
      SELECT count(*)::int AS written FROM written`.pipe(
      Effect.flatMap(([row]) => Schema.decodeUnknownEffect(Written)(row)),
      Effect.map(({ written }) => written),
      orDataSourceError,
    );
  };

  const run = ({ dryRun, within, maxEvents }: CompanyHostsOptions) =>
    Option.match(api.eventPeople, {
      onNone: () =>
        Effect.succeed<CompanyHostsRun>({
          _tag: "Skipped",
          reason: "LUMA_API_KEY is not set",
        }),
      onSome: (eventPeople) =>
        Effect.gen(function* () {
          const now = yield* DateTime.now;
          const since = DateTime.subtractDuration(
            now,
            Duration.fromInputUnsafe(within),
          );
          const stored = yield* read(since, maxEvents ?? null);
          const answers = yield* Effect.forEach(
            stored.evenings,
            (evening) =>
              Effect.map(eventPeople(evening.lumaEventId), (people) => ({
                evening,
                people,
              })),
            { concurrency },
          );
          const shown: Array<{
            evening: AskedEvening;
            people: LumaEventPeople;
          }> = [];
          const unavailable: Array<string> = [];
          for (const { evening, people } of answers) {
            if (Option.isSome(people)) {
              shown.push({ evening, people: people.value });
            } else {
              unavailable.push(evening.lumaEventId);
            }
          }
          const plan = planCompanyHosts(
            shown,
            stored.companies,
            new Set(stored.people),
            new Set(stored.attached),
          );
          const written = dryRun
            ? null
            : plan.attach.length === 0
              ? 0
              : yield* write(plan.attach, now);
          return {
            _tag: "Planned",
            asked: stored.evenings.length,
            plan,
            unavailable,
            written,
          } satisfies CompanyHostsRun;
        }),
    }).pipe(
      Effect.withSpan("LumaCompanyHosts.run", { attributes: { dryRun } }),
    );

  return LumaCompanyHosts.of({ run });
});

export class LumaCompanyHosts extends Context.Service<
  LumaCompanyHosts,
  LumaCompanyHostsShape
>()("allthings/LumaCompanyHosts") {
  /** Needs `LumaApi` and a `SqlClient`. */
  static readonly layer = Layer.effect(LumaCompanyHosts, make);
}
