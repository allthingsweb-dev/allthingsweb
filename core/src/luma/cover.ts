import { Clock, Context, Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { approvalToken } from "../approval.ts";
import {
  type CoverFacts,
  coverFactsOf,
  CoverRenderer,
  type CoverUnrendered,
  isLumaDefaultCover,
  isStockCover,
  sha256,
} from "../cover.ts";
import { DataSourceError } from "../errors.ts";
import { actorFor, logDraft } from "../planning/draft-log.ts";
import { EventPages } from "../event-page.ts";
import { ShortSlugs } from "../slugs.ts";
import { type EventRef, StudioRefused } from "./publish.ts";
import { LumaWrite, type LumaWriteError, type ManagedEvent } from "./write.ts";

/**
 * Every evening's Luma cover is its own, drawn by the brand's template from
 * its facts (src/cover.ts), and never Luma's default. `bun run luma cover`
 * puts it there, in two steps as publishing does:
 *
 * - `prepare` draws the cover the evening's facts say, and says what it
 *   would replace (Luma's cover now, and whether that is Luma's default or
 *   the one we last set) and the approval token for exactly that: the
 *   first 16 hex digits of the SHA-256 of the event (with its visibility
 *   and dates on Luma), the facts, the drawn PNG's SHA-256 and the cover it
 *   replaces, as canonical JSON.
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
 * cover can still be drawn and read, for an evening already out. One
 * exception: a past evening of ours, over on Luma too, that still shows a stock photo (one of
 * Luma's defaults, or an Unsplash picture, src/cover.ts) may get its own
 * cover, public or not. Nobody is coming to it any more, and a cover we
 * uploaded is never replaced this way. A draft never is. If recording such
 * a cover fails, the stock photo is put back on Luma, so the evening is as
 * it was and approving again can finish it.
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

  const prepare = (ref: EventRef) =>
    Effect.gen(function* () {
      const row = yield* eveningOf(ref);
      const { facts, token: factsToken } = yield* coverFactsOf(
        pages,
        slugs,
        row,
      ).pipe(
        Effect.catchTag("EventNotFound", () =>
          refuse(`No evening, published or draft, is ${row.slug}.`),
        ),
      );
      const png = yield* renderer.render(facts);
      const digest = yield* sha256(png);
      const event = yield* luma.get(row.lumaEventId);
      // A past evening still showing a stock photo may get its own cover,
      // public or not: past on its page (facts.ahead) and over on Luma (its
      // end, or its start without one), by the same clock.
      const lumaOver =
        Date.parse(event.end_at ?? event.start_at) <=
        (yield* Clock.currentTimeMillis);
      // Published evenings only: a draft's Luma page changes only through
      // publish, whatever its dates say.
      const pastStock =
        !row.isDraft &&
        !facts.ahead &&
        lumaOver &&
        isStockCover(event.cover_url);
      const refused =
        event.access !== "manage"
          ? `${row.lumaEventId} is not our calendar's to change.`
          : event.visibility === "public" && !pastStock
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
        factsToken,
        sha256: digest,
        png,
        current,
        token: yield* approvalToken({
          lumaEventId: row.lumaEventId,
          // What decides whether it may be set at all, so a change to any
          // of it between the dry run and the approval stops the approval.
          visibility: event.visibility,
          startAt: event.start_at,
          endAt: event.end_at,
          facts,
          sha256: digest,
          replaces: event.cover_url,
        }),
        refused,
      } satisfies PreparedCover;
    });

  const approve = (ref: EventRef, token: string) =>
    Effect.gen(function* () {
      yield* actorFor(refuse);
      const prepared = yield* prepare(ref);
      if (prepared.refused !== null) return yield* refuse(prepared.refused);
      if (prepared.token !== token) {
        return yield* refuse(
          `The cover, what it would replace or the event on Luma has changed since ${token} was approved: it is now ${prepared.token}. Read it again with --dry-run, and approve that.`,
        );
      }
      const fileUrl = yield* luma.uploadImage(prepared.png, "image/png");
      yield* luma.update(prepared.lumaEventId, { cover_url: fileUrl });
      const after = yield* luma.get(prepared.lumaEventId);
      const coverUrl = after.cover_url;
      // Only the uploaded cover is recorded as ours: anything else on the
      // event now (the old one, Luma's default, another upload) is not.
      if (coverUrl !== fileUrl) {
        return yield* refuse(
          `Luma took the update but ${after.name}'s cover is ${coverUrl ?? "none"}, not the one uploaded (${fileUrl}). Nothing was recorded.`,
        );
      }
      // Recorded only on the evening it was drawn for, while it is still
      // ours to change (above); its stored copy of the old cover is let go, so the
      // ingestion stores this one.
      // Recorded with its line in the draft's log, in one transaction.
      const recorded = yield* sql
        .withTransaction(
          Effect.gen(function* () {
            const rows = yield* sql`
              UPDATE events SET
                generated_cover_url = ${coverUrl},
                generated_cover_sha256 = ${prepared.sha256},
                generated_cover_facts = ${prepared.factsToken},
                preview_image = NULL,
                updated_at = now()
              WHERE luma_event_id = ${prepared.lumaEventId}
              RETURNING id`;
            yield* logDraft({
              event: { lumaEventId: prepared.lumaEventId },
              command: "luma cover",
              summary:
                "Set its cover on Luma, drawn from its facts as they are.",
              payload: {
                coverUrl,
                sha256: prepared.sha256,
              },
            }).pipe(Effect.provideService(SqlClient, sql));
            return rows;
          }),
        )
        .pipe(
          Effect.catch((cause) => {
            const why = cause instanceof Error ? cause.message : String(cause);
            // A public evening (a past one, the only kind that gets here) is
            // out of reach once it shows an upload, so a retry couldn't record
            // it: put the stock photo back, and the evening is as it was.
            if (
              prepared.visibility !== "public" ||
              prepared.current.url === null
            ) {
              return refuse(
                `Luma has the cover (${coverUrl}), but recording it here failed: ${why}. Run luma cover --dry-run and approve again to record it.`,
              );
            }
            const replaced = prepared.current.url;
            const stuck = (because: string) =>
              refuse(
                `Luma has the cover (${coverUrl}), but recording it here failed (${why}), and putting its old cover back failed too (${because}). Set its cover back to ${replaced} in Luma, then run luma cover --dry-run and approve again.`,
              );
            return Effect.gen(function* () {
              // Read first: put the old cover back only over our own upload,
              // never over a cover someone set since. Luma's update takes no
              // precondition, so this narrows the window; it can't close it.
              const now = yield* luma.get(prepared.lumaEventId);
              if (now.cover_url !== coverUrl) {
                return yield* refuse(
                  `Recording the cover here failed: ${why}. Luma now shows ${now.cover_url ?? "no cover"}, set since our upload (${coverUrl}), so it was left alone and nothing was recorded.`,
                );
              }
              yield* luma.update(prepared.lumaEventId, { cover_url: replaced });
              // Read back: only Luma showing the old cover again means the
              // evening is as it was.
              const restored = yield* luma.get(prepared.lumaEventId);
              if (restored.cover_url !== replaced) {
                return yield* stuck(
                  `Luma shows ${restored.cover_url ?? "no cover"}`,
                );
              }
              return yield* refuse(
                `Recording the cover here failed: ${why}. Its old cover (${replaced}) is back on Luma, so nothing changed. Run luma cover --dry-run and approve again.`,
              );
            }).pipe(
              Effect.catch((error) =>
                error instanceof StudioRefused
                  ? Effect.fail(error)
                  : stuck(error.message),
              ),
            );
          }),
        );
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
