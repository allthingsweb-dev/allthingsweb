import { Context, Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { approvalToken } from "../approval.ts";
import {
  type CoverFacts,
  coverFacts,
  CoverRenderer,
  type CoverUnrendered,
  isLumaDefaultCover,
  sha256,
} from "../cover.ts";
import { DataSourceError } from "../errors.ts";
import { EventPages } from "../event-page.ts";
import { ShortSlugs } from "../slugs.ts";
import { type EventRef, siteOrigin, StudioRefused } from "./publish.ts";
import { LumaWrite, type LumaWriteError, type ManagedEvent } from "./write.ts";

/**
 * Every evening's Luma cover is its own, drawn by the brand's template from
 * its facts (src/cover.ts), and never Luma's default. `bun run luma cover`
 * puts it there, in two steps as publishing does:
 *
 * - `prepare` draws the cover the evening's facts say, and says what it
 *   would replace (Luma's cover now, and whether that is Luma's default or
 *   the one we last set) and the approval token for exactly that: the
 *   first 16 hex digits of the SHA-256 of the event, the facts, the drawn
 *   PNG's SHA-256 and the cover it replaces, as canonical JSON.
 * - `approve` takes that token, draws and works it out again, and goes on
 *   only if it hashes the same. It uploads the PNG to Luma's CDN, sets it
 *   as the event's cover, reads the event back to check it took, and
 *   records it on the evening (`generated_cover_url`, `_sha256` and
 *   `_facts`, migrations/0025_generated_cover.ts), which readiness compares
 *   against. The evening's stored copy of the old cover is let go, so the
 *   hourly image ingestion stores the new one (src/ingest/ingest.ts).
 *
 * Only a private event of ours is ever changed: a public one changes only
 * through publish, and a shared one's Luma page is its organizer's. Its
 * cover can still be drawn and read, for an evening already out.
 *
 * The short link a draft's cover prints is the one it will get when it is
 * published (src/slugs.ts, by the same dry run the sync's rehearsal uses).
 */

/** The cover a prepare drew, and what approving it would do. */
export interface PreparedCover {
  readonly lumaEventId: string;
  /** The evening's long slug. */
  readonly slug: string;
  readonly name: string;
  readonly visibility: ManagedEvent["visibility"];
  readonly facts: CoverFacts;
  /** The approval token of the facts alone, which the evening records. */
  readonly factsToken: string;
  /** The drawn PNG's SHA-256. */
  readonly sha256: string;
  /** The drawn PNG. */
  readonly png: Uint8Array;
  /** Luma's cover now. */
  readonly current: {
    readonly url: string | null;
    /** One of Luma's own (src/cover.ts). */
    readonly lumaDefault: boolean;
    /** The one we last set and recorded. */
    readonly ours: boolean;
  };
  readonly token: string;
  /** Why approving it would be refused, if it would. */
  readonly refused: string | null;
}

export type CoverFailure =
  | StudioRefused
  | DataSourceError
  | LumaWriteError
  | CoverUnrendered;

export interface CoversShape {
  readonly prepare: (
    ref: EventRef,
  ) => Effect.Effect<PreparedCover, CoverFailure>;
  readonly approve: (
    ref: EventRef,
    token: string,
  ) => Effect.Effect<
    PreparedCover & { readonly coverUrl: string },
    CoverFailure
  >;
}

/** The one origin pages load photos from; a cover reads none. */
const photoOrigin = "https://media.allthings.dev";

const Row = Schema.Struct({
  id: Schema.String,
  slug: Schema.String,
  shortSlug: Schema.NullOr(Schema.String),
  lumaEventId: Schema.NullOr(Schema.String),
  isDraft: Schema.Boolean,
  curation: Schema.Literals(["ours", "shared"]),
  generatedCoverUrl: Schema.NullOr(Schema.String),
});

const refuse = (reason: string) => Effect.fail(new StudioRefused({ reason }));

const make = Effect.gen(function* () {
  const sql = yield* SqlClient;
  const luma = yield* LumaWrite;
  const pages = yield* EventPages;
  const slugs = yield* ShortSlugs;
  const renderer = yield* CoverRenderer;
  const siteHost = new URL(siteOrigin).host;

  const orDataSourceError = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.mapError(effect, (cause) => new DataSourceError({ cause }));

  /** The evening `ref` names. */
  const eveningOf = (ref: EventRef) =>
    Effect.gen(function* () {
      const columns = sql`
        SELECT id, slug, short_slug AS "shortSlug",
          luma_event_id AS "lumaEventId", is_draft AS "isDraft", curation,
          generated_cover_url AS "generatedCoverUrl"
        FROM events`;
      const rows = yield* (
        ref._tag === "Slug"
          ? sql`${columns} WHERE slug = ${ref.slug} OR short_slug = ${ref.slug}`
          : sql`${columns} WHERE luma_event_id = ${ref.lumaEventId}`
      ).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Row))),
        orDataSourceError,
      );
      const [row] = rows;
      const named = ref._tag === "Slug" ? ref.slug : ref.lumaEventId;
      if (row === undefined) {
        return yield* refuse(`No evening, published or draft, is ${named}.`);
      }
      if (row.curation === "shared") {
        return yield* refuse(
          `${row.slug} is shared: its Luma page, cover and all, is its organizer's.`,
        );
      }
      if (row.lumaEventId === null) {
        return yield* refuse(`${row.slug} has no Luma event yet.`);
      }
      return { ...row, lumaEventId: row.lumaEventId };
    });

  /** The short link the evening has, or the one it gets when published. */
  const linkOf = (row: typeof Row.Type & { readonly lumaEventId: string }) =>
    row.shortSlug !== null
      ? Effect.succeed(row.shortSlug)
      : slugs
          .assign({
            dryRun: true,
            published: [{ lumaEventId: row.lumaEventId }],
          })
          .pipe(
            Effect.map(
              ({ given }) =>
                given.find((link) => link.eventId === row.id)?.shortSlug ??
                row.slug,
            ),
          );

  const prepare = (ref: EventRef) =>
    Effect.gen(function* () {
      const row = yield* eveningOf(ref);
      const page = yield* (
        row.isDraft
          ? pages.readDraft(row.slug, photoOrigin)
          : pages.read(row.slug, photoOrigin)
      ).pipe(
        Effect.catchTag("EventNotFound", () =>
          refuse(`No evening, published or draft, is ${row.slug}.`),
        ),
      );
      const facts = coverFacts(page, yield* linkOf(row), siteHost);
      const png = yield* renderer.render(facts);
      const digest = yield* sha256(png);
      const event = yield* luma.get(row.lumaEventId);
      const refused =
        event.access !== "manage"
          ? `${row.lumaEventId} is not our calendar's to change.`
          : event.visibility === "public"
            ? `${event.name} is public on Luma: what the public sees changes only through publish.`
            : null;
      const current = {
        url: event.cover_url,
        lumaDefault: isLumaDefaultCover(event.cover_url),
        ours:
          event.cover_url !== null && event.cover_url === row.generatedCoverUrl,
      };
      return {
        lumaEventId: row.lumaEventId,
        slug: row.slug,
        name: event.name,
        visibility: event.visibility,
        facts,
        factsToken: yield* approvalToken(facts),
        sha256: digest,
        png,
        current,
        token: yield* approvalToken({
          lumaEventId: row.lumaEventId,
          facts,
          sha256: digest,
          replaces: event.cover_url,
        }),
        refused,
      } satisfies PreparedCover;
    });

  const approve = (ref: EventRef, token: string) =>
    Effect.gen(function* () {
      const prepared = yield* prepare(ref);
      if (prepared.refused !== null) return yield* refuse(prepared.refused);
      if (prepared.token !== token) {
        return yield* refuse(
          `The cover, or what it would replace, has changed since ${token} was approved: it is now ${prepared.token}. Read it again with --dry-run, and approve that.`,
        );
      }
      const fileUrl = yield* luma.uploadImage(prepared.png, "image/png");
      yield* luma.update(prepared.lumaEventId, { cover_url: fileUrl });
      const after = yield* luma.get(prepared.lumaEventId);
      const coverUrl = after.cover_url;
      if (
        coverUrl === null ||
        coverUrl === prepared.current.url ||
        isLumaDefaultCover(coverUrl)
      ) {
        return yield* refuse(
          `Luma took the update but ${after.name}'s cover is ${coverUrl ?? "none"}, not the one uploaded (${fileUrl}).`,
        );
      }
      if (coverUrl !== fileUrl) {
        yield* Effect.logWarning(
          `Luma stored the cover at ${coverUrl}, not ${fileUrl}; that is what is recorded.`,
        );
      }
      // Recorded only on the evening it was drawn for, while it is still
      // our private one; its stored copy of the old cover is let go, so the
      // ingestion stores this one.
      const recorded = yield* sql`
        UPDATE events SET
          generated_cover_url = ${coverUrl},
          generated_cover_sha256 = ${prepared.sha256},
          generated_cover_facts = ${prepared.factsToken},
          preview_image = NULL,
          updated_at = now()
        WHERE luma_event_id = ${prepared.lumaEventId}
        RETURNING id`.pipe(orDataSourceError);
      if (recorded.length !== 1) {
        return yield* refuse(
          `Luma has the cover (${coverUrl}), but no evening here has ${prepared.lumaEventId} to record it on.`,
        );
      }
      return { ...prepared, coverUrl };
    });

  return Covers.of({ prepare, approve });
});

export class Covers extends Context.Service<Covers, CoversShape>()(
  "allthings/Covers",
) {
  static readonly layer = Layer.effect(Covers, make);
}
