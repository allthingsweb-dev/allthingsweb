import { Context, DateTime, Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { Completeness } from "../completeness.ts";
import { DataSourceError } from "../errors.ts";
import { EventPages } from "../event-page.ts";
import { formats } from "../formats.ts";
import { coverFactsOf } from "../cover.ts";
import { eventTopic } from "../lockup.ts";
import type { HostProspect, Idea, WantedSpeaker } from "../planning/model.ts";
import { Planning, PlanningError } from "../planning/planning.ts";
import type { EventProgram } from "../rows.ts";
import { ShortSlugs } from "../slugs.ts";
import { sfDay } from "./calendar.ts";
import { type CalendarEvent, type Check, draftChecks } from "./checks.ts";
import {
  dateWindow,
  type HostHistory,
  type HostSuggestion,
  type NetworkPerson,
  type OpenDates,
  openDates,
  quietHosts,
  rankSpeakers,
  rankWanted,
  type SpeakerSuggestion,
  type Wanted,
  type WantedSuggestion,
  wordsOf,
} from "./suggestions.ts";

/**
 * How ready a draft evening is to go out, and what to add: the checks in
 * checks.ts and the suggestions in suggestions.ts, over what the
 * database holds at the Clock's now. The CLI (scripts/readiness.ts) and the admin
 * MCP server's get_draft_readiness both run it.
 *
 * A draft is an event the Luma sync stored as one (a private or cancelled
 * Luma event), named by slug, or an idea from planning, named by id: the
 * idea's draft evening when it has one, else the idea alone, which has
 * everything still to do. Planning's wanted speakers and host prospects
 * join the suggestions when the role may read planning (the owner); as
 * any other role, the report says it left them out.
 */

/** What the report is about. */
export type DraftRef =
  | { readonly _tag: "Event"; readonly slug: string }
  | { readonly _tag: "Idea"; readonly id: string };

export interface ReadinessReport {
  readonly subject:
    | {
        readonly kind: "event";
        readonly slug: string;
        readonly name: string;
        readonly isDraft: boolean;
        readonly program: EventProgram;
        readonly topic: string | null;
        readonly startDate: string;
        readonly endDate: string;
        /** Its day in San Francisco. */
        readonly day: string;
      }
    | {
        readonly kind: "idea";
        readonly id: string;
        readonly title: string;
        readonly program: EventProgram;
        readonly topic: string | null;
      };
  /** The idea it comes from, when planning has one and may be read. */
  readonly idea: Idea | null;
  /** No check blocks it. */
  readonly ready: boolean;
  readonly checks: ReadonlyArray<Check>;
  readonly suggestions: {
    /** The words the suggestions match on: the evening's topics and any asked for. */
    readonly terms: ReadonlyArray<string>;
    readonly speakers: {
      /** Whether its program has a lineup (talks, an open floor). */
      readonly lineup: boolean;
      readonly network: ReadonlyArray<SpeakerSuggestion>;
      readonly wanted: ReadonlyArray<WantedSuggestion>;
    };
    readonly hosts: {
      readonly prospects: ReadonlyArray<{
        readonly id: string;
        readonly name: string;
        readonly status: HostProspect["status"];
        readonly lastHosted: string | null;
      }>;
      readonly quiet: ReadonlyArray<HostSuggestion>;
    };
    readonly dates: OpenDates;
    /** Who came to the evening it builds on: Luma's count, since no guest lists are stored. */
    readonly attendees: {
      readonly listsStored: false;
      readonly inspiredBy: {
        readonly slug: string;
        readonly guests: number | null;
      } | null;
    };
  };
  /** Whether planning's rows joined the suggestions. */
  readonly planning: "read" | "not readable as this role";
}

export interface ReadinessShape {
  readonly report: (
    draft: DraftRef,
    options?: { readonly topics?: ReadonlyArray<string> },
  ) => Effect.Effect<ReadinessReport, PlanningError | DataSourceError>;
}

const Facts = Schema.Struct({
  id: Schema.String,
  slug: Schema.String,
  shortSlug: Schema.NullOr(Schema.String),
  lumaEventId: Schema.NullOr(Schema.String),
  generatedCoverFacts: Schema.NullOr(Schema.String),
  isDraft: Schema.Boolean,
  shortLocation: Schema.NullOr(Schema.String),
  scheduleItems: Schema.Number,
  hostIds: Schema.Array(Schema.String),
  peopleIds: Schema.Array(Schema.String),
});

const CalendarRow = Schema.Struct({
  slug: Schema.String,
  name: Schema.String,
  startDate: Schema.DateTimeUtcFromDate,
  endDate: Schema.DateTimeUtcFromDate,
  isDraft: Schema.Boolean,
  curation: Schema.Literals(["ours", "shared"]),
});

const TalkRow = Schema.Struct({
  profileId: Schema.String,
  name: Schema.String,
  title: Schema.String,
  description: Schema.String,
  eventSlug: Schema.String,
  eventName: Schema.String,
  eventTopic: Schema.NullOr(Schema.String),
  endDate: Schema.DateTimeUtcFromDate,
});

const HostRow = Schema.Struct({
  sponsorId: Schema.String,
  name: Schema.String,
  evenings: Schema.Number,
  lastHosted: Schema.DateTimeUtcFromDate,
  lastAddress: Schema.NullOr(Schema.String),
});

const GuestsRow = Schema.Struct({
  slug: Schema.String,
  guests: Schema.NullOr(Schema.Number),
});

const wantedOf = (speaker: WantedSpeaker): Wanted => ({
  id: speaker.id,
  name:
    speaker.person.kind === "profile"
      ? speaker.person.name
      : speaker.person.contact.name,
  profileId:
    speaker.person.kind === "profile" ? speaker.person.profileId : null,
  status: speaker.status,
  topics: speaker.topics,
  availability: speaker.availability,
});

const hostStatusRank = { confirmed: 0, asked: 1, prospect: 2, declined: 3 };

/** People in the network, each with every talk, in the order the rows came. */
const toNetwork = (
  rows: ReadonlyArray<typeof TalkRow.Type>,
): ReadonlyArray<NetworkPerson> => {
  const people = new Map<
    string,
    { name: string; talks: Array<NetworkPerson["talks"][number]> }
  >();
  for (const row of rows) {
    const person = people.get(row.profileId) ?? { name: row.name, talks: [] };
    person.talks.push({
      title: row.title,
      description: row.description,
      eventSlug: row.eventSlug,
      eventName: row.eventName,
      eventTopic: row.eventTopic,
      endDate: row.endDate,
    });
    people.set(row.profileId, person);
  }
  return [...people.entries()].map(([profileId, person]) => ({
    profileId,
    ...person,
  }));
};

const make = Effect.gen(function* () {
  const sql = yield* SqlClient;
  const completeness = yield* Completeness;
  const planning = yield* Planning;
  const pages = yield* EventPages;
  const slugs = yield* ShortSlugs;

  /**
   * Whether the evening's cover is ours and says what its facts say now:
   * the facts' token recorded when it was set, against today's.
   */
  const coverOf = (fact: typeof Facts.Type) =>
    fact.lumaEventId === null || fact.generatedCoverFacts === null
      ? Effect.succeed("not ours" as const)
      : coverFactsOf(pages, slugs, {
          ...fact,
          lumaEventId: fact.lumaEventId,
        }).pipe(
          Effect.map(({ token }) =>
            token === fact.generatedCoverFacts
              ? ("ours" as const)
              : ("stale" as const),
          ),
          Effect.catchTag("EventNotFound", (cause) =>
            Effect.fail(new DataSourceError({ cause })),
          ),
        );

  const decode =
    <S extends Schema.Top>(schema: S) =>
    (rows: unknown) =>
      Schema.decodeUnknownEffect(Schema.Array(schema))(rows);

  const planningReadable = sql<{ readable: boolean }>`
    SELECT EXISTS (
      SELECT 1 FROM pg_catalog.pg_namespace n
      WHERE n.nspname = 'planning' AND pg_catalog.has_schema_privilege(n.oid, 'USAGE')
    ) AS readable`.pipe(Effect.map(([row]) => row?.readable === true));

  const facts = (slug: string) =>
    sql`
      SELECT e.id, e.slug, e.short_slug AS "shortSlug",
        e.luma_event_id AS "lumaEventId",
        e.generated_cover_facts AS "generatedCoverFacts",
        e.is_draft AS "isDraft", e.short_location AS "shortLocation",
        (SELECT count(*)::int FROM event_schedule_items si WHERE si.event_id = e.id) AS "scheduleItems",
        COALESCE((SELECT json_agg(es.sponsor_id ORDER BY es.sponsor_id) FROM event_sponsors es WHERE es.event_id = e.id), '[]'::json) AS "hostIds",
        COALESCE((SELECT json_agg(DISTINCT id) FROM (
          SELECT ts.speaker_id AS id FROM event_talks et JOIN talk_speakers ts ON ts.talk_id = et.talk_id WHERE et.event_id = e.id
          UNION SELECT ep.profile_id FROM event_people ep WHERE ep.event_id = e.id
        ) lineup), '[]'::json) AS "peopleIds"
      FROM events e WHERE e.slug = ${slug}`.pipe(Effect.flatMap(decode(Facts)));

  const calendar = sql`
    SELECT slug, name, start_date AS "startDate", end_date AS "endDate",
      is_draft AS "isDraft", curation
    FROM events ORDER BY start_date, id`.pipe(
    Effect.flatMap(decode(CalendarRow)),
  );

  const network = (now: DateTime.Utc) =>
    sql`
      SELECT p.id AS "profileId", p.name, t.title, t.description,
        e.slug AS "eventSlug", e.name AS "eventName", e.topic AS "eventTopic",
        e.end_date AS "endDate"
      FROM profiles p
      JOIN talk_speakers ts ON ts.speaker_id = p.id
      JOIN talks t ON t.id = ts.talk_id
      JOIN event_talks et ON et.talk_id = t.id
      JOIN events e ON e.id = et.event_id
      WHERE NOT e.is_draft AND e.end_date <= ${DateTime.toDateUtc(now)}
      ORDER BY p.id, e.end_date, t.id`.pipe(
      Effect.flatMap(decode(TalkRow)),
      Effect.map(toNetwork),
    );

  const hostHistory = (now: DateTime.Utc) =>
    sql`
      SELECT s.id AS "sponsorId", s.name, count(*)::int AS evenings,
        max(e.start_date) AS "lastHosted",
        (SELECT COALESCE(l.full_address, l.street_address)
          FROM event_sponsors les JOIN events l ON l.id = les.event_id
          WHERE les.sponsor_id = s.id AND NOT l.is_draft AND l.curation = 'ours'
          ORDER BY l.start_date DESC, l.id LIMIT 1) AS "lastAddress"
      FROM sponsors s
      JOIN event_sponsors es ON es.sponsor_id = s.id
      JOIN events e ON e.id = es.event_id
      WHERE NOT e.is_draft AND e.curation = 'ours' AND e.start_date <= ${DateTime.toDateUtc(now)}
      GROUP BY s.id, s.name
      ORDER BY s.name, s.id`.pipe(
      Effect.flatMap(decode(HostRow)),
      Effect.map((rows): ReadonlyArray<HostHistory> => rows),
    );

  const guests = (slug: string) =>
    sql`SELECT slug, luma_guest_count AS guests FROM events WHERE slug = ${slug}`.pipe(
      Effect.flatMap(decode(GuestsRow)),
      Effect.map(([row]) => row ?? null),
    );

  const report = (
    draft: DraftRef,
    options: { readonly topics?: ReadonlyArray<string> } = {},
  ) =>
    Effect.gen(function* () {
      const now = yield* DateTime.now;
      const today = sfDay(now);
      const readable = yield* planningReadable;
      const ideas = readable ? yield* planning.listIdeas() : [];

      let idea: Idea | null = null;
      let slug: string | null = null;
      if (draft._tag === "Idea") {
        if (!readable) {
          return yield* new PlanningError({
            reason:
              "Planning can't be read as this role, so no idea can be: run it as the database owner.",
          });
        }
        idea = ideas.find((candidate) => candidate.id === draft.id) ?? null;
        if (idea === null) {
          return yield* new PlanningError({
            reason: `No idea has the id ${draft.id}.`,
          });
        }
        slug = idea.event?.slug ?? null;
      } else {
        slug = draft.slug;
        idea =
          ideas.find((candidate) => candidate.event?.slug === draft.slug) ??
          null;
      }

      const stored = slug === null ? null : yield* completeness.record(slug);
      const [fact] = slug === null ? [] : yield* facts(slug);
      // A draft's lineup is kept private in planning until it is published
      // (src/luma/publish.ts copies it): read with the public one.
      const plannedPeople =
        stored !== null && fact?.isDraft === true && readable
          ? yield* completeness.plannedPeople(stored.slug)
          : [];
      const record =
        stored === null || plannedPeople.length === 0
          ? stored
          : {
              ...stored,
              people: [
                ...stored.people,
                ...plannedPeople.filter(
                  (entry) =>
                    !stored.people.some(
                      (own) =>
                        own.role === entry.role &&
                        own.person.id === entry.person.id,
                    ),
                ),
              ],
            };
      if (slug !== null && record === null) {
        return yield* new PlanningError({
          reason: `No event, published or draft, has the slug "${slug}".`,
        });
      }
      const events: ReadonlyArray<CalendarEvent> = yield* calendar;

      // A draft that came from an idea is the idea's kind of evening until it
      // is published: the program is kept in planning, private, and publish
      // writes it to the event (src/luma/publish.ts).
      const planned =
        record !== null &&
        fact?.isDraft === true &&
        idea !== null &&
        idea.status !== "dropped"
          ? idea.program
          : null;
      const checked =
        record === null || planned === null
          ? record
          : { ...record, program: planned };
      const program: EventProgram =
        checked?.program ?? idea?.program ?? "talks";
      const topic =
        (record === null ? undefined : eventTopic(record)) ??
        idea?.topic ??
        null;
      const terms = wordsOf(
        topic ?? "",
        idea?.topic ?? "",
        ...(options.topics ?? []),
      );

      const checks: ReadonlyArray<Check> =
        record === null || fact === undefined
          ? [
              {
                kind: "luma-event",
                level: "blocker",
                subject: null,
                message:
                  "No draft evening yet: make its private Luma event (bun run luma create), then store it as a draft (bun run luma:drafts --add evt-…).",
              },
            ]
          : draftChecks(
              {
                record: checked ?? record,
                isDraft: fact.isDraft,
                shortLocation: fact.shortLocation,
                scheduleItems: fact.scheduleItems,
                // A shared evening's cover is its organizer's: nothing to read.
                cover:
                  (checked ?? record).curation.kind === "ours"
                    ? yield* coverOf(fact)
                    : "not ours",
              },
              events,
              now,
            );

      const day = record === null ? null : sfDay(record.startDate);
      const onIt = new Set(fact?.peopleIds ?? []);
      const hostsOnIt = new Set(fact?.hostIds ?? []);
      const wantedRows = readable ? yield* planning.listWantedSpeakers() : [];
      const wanted = rankWanted(terms, wantedRows.map(wantedOf), day, onIt);
      const prospects = readable ? yield* planning.listHostProspects() : [];
      const window = dateWindow(day, today);
      const matchingWanted = wantedRows
        .map(wantedOf)
        .filter((speaker) => wanted.some((match) => match.id === speaker.id));
      const inspiredSlug = idea?.inspiredBy?.slug ?? null;
      const inspired =
        inspiredSlug === null ? null : yield* guests(inspiredSlug);

      return {
        subject:
          record === null
            ? {
                kind: "idea" as const,
                id: idea?.id ?? "",
                title: idea?.title ?? "",
                program,
                topic,
              }
            : {
                kind: "event" as const,
                slug: record.slug,
                name: record.name,
                isDraft: fact?.isDraft ?? false,
                program,
                topic,
                startDate: DateTime.formatIso(record.startDate),
                endDate: DateTime.formatIso(record.endDate),
                day: sfDay(record.startDate),
              },
        idea,
        ready: checks.every((entry) => entry.level !== "blocker"),
        checks,
        suggestions: {
          terms,
          speakers: {
            lineup: formats[program].stage !== null,
            network: rankSpeakers(terms, yield* network(now), onIt),
            wanted,
          },
          hosts: {
            prospects: prospects
              .filter(
                (prospect) =>
                  prospect.status !== "declined" &&
                  !(
                    prospect.company.kind === "host" &&
                    hostsOnIt.has(prospect.company.sponsorId)
                  ),
              )
              .map((prospect) => ({
                id: prospect.id,
                name: prospect.company.name,
                status: prospect.status,
                lastHosted:
                  prospect.lastHosted === null
                    ? null
                    : sfDay(DateTime.makeUnsafe(prospect.lastHosted.startDate)),
              }))
              .toSorted(
                (a, b) =>
                  hostStatusRank[a.status] - hostStatusRank[b.status] ||
                  a.name.localeCompare(b.name),
              ),
            quiet: quietHosts(
              yield* hostHistory(now),
              // Quiet by the draft's day, or by today once that has passed.
              day !== null && day > today ? day : today,
              hostsOnIt,
            ),
          },
          dates: openDates(
            events,
            window.from,
            window.to,
            record?.slug ?? null,
            matchingWanted,
          ),
          attendees: {
            listsStored: false as const,
            inspiredBy: inspired,
          },
        },
        planning: readable
          ? ("read" as const)
          : ("not readable as this role" as const),
      } satisfies ReadinessReport;
    }).pipe(
      Effect.catchTag(["SqlError", "SchemaError"], (cause) =>
        Effect.fail(new DataSourceError({ cause })),
      ),
    );

  return Readiness.of({ report });
});

export class Readiness extends Context.Service<Readiness, ReadinessShape>()(
  "allthings/Readiness",
) {
  static readonly layer = Layer.effect(Readiness, make).pipe(
    Layer.provide(
      Layer.mergeAll(
        Completeness.layer,
        Planning.layer,
        EventPages.layer,
        ShortSlugs.layer,
      ),
    ),
  );
}
