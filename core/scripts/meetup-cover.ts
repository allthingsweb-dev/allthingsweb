import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Console, Effect, Option, Schema } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { SqlClient } from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";
import * as Database from "../src/database.ts";
import { fetchHttps, fileSlug, readAtMost } from "./cover-file.ts";
import { padCover } from "./pad-cover.ts";

/**
 * Writes an evening's cover padded to 16:9 on black (scripts/pad-cover.ts),
 * for Meetup, whose 16:9 crop would cut a square Luma cover. It reads the
 * cover stored for the evening, so it only reads the Postgres at
 * DATABASE_URL: production's read-only site_reader role is enough.
 *
 *   bun run promo:cover <slug> [--out <file>]
 *
 * The JPEG goes to --out, by default meetup-cover-<slug>.jpg in a fresh
 * directory under the system's temporary one, a scratch copy to upload and
 * forget. The cover is fetched over https only, redirects included.
 * DATABASE_URL comes from the environment only.
 */

/** The most a cover may weigh; Luma's are far below it. */
const maxCoverBytes = 30 * 1024 * 1024;

class CoverError extends Schema.TaggedError<CoverError>()("CoverError", {
  message: Schema.String,
}) {}

const coverOf = Effect.gen(function* () {
  const sql = yield* SqlClient;
  return SqlSchema.findOneOption({
    Request: Schema.String,
    Result: Schema.Struct({ url: Schema.NullOr(Schema.String) }),
    execute: (slug) => sql`
      SELECT i.url
      FROM events e
      LEFT JOIN images i ON i.id = e.preview_image
      WHERE e.slug = ${slug} AND e.is_draft = false`,
  });
});

/** The cover's bytes, from an https URL only, within {@link maxCoverBytes}. */
const download = (raw: string) =>
  Effect.tryPromise({
    try: async (signal) => {
      const response = await fetchHttps(raw, signal);
      if (!response.ok) throw new Error(`${response.status} from ${raw}`);
      const length = Number(response.headers.get("content-length") ?? 0);
      if (length > maxCoverBytes) throw new Error(`${raw} is ${length} bytes`);
      return readAtMost(response, maxCoverBytes, raw);
    },
    catch: (cause) =>
      new CoverError({
        message: `Could not download the cover: ${describe(cause)}`,
      }),
  });

/** What went wrong, in words. */
const describe = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const command = Command.make(
  "promo:cover",
  {
    slug: Argument.String("slug").pipe(
      Argument.withDescription("The evening's slug."),
    ),
    out: Flag.String("out").pipe(
      Flag.withDescription("Where to write the JPEG."),
      Flag.optional,
    ),
  },
  ({ slug, out }) =>
    Effect.gen(function* () {
      const find = yield* coverOf;
      const url = yield* find(slug).pipe(
        Effect.flatMap((row) =>
          Option.isNone(row)
            ? Effect.fail(
                new CoverError({
                  message: `No published event has the slug "${slug}".`,
                }),
              )
            : row.value.url === null
              ? Effect.fail(
                  new CoverError({
                    message: `${slug} has no cover on record yet.`,
                  }),
                )
              : Effect.succeed(row.value.url),
        ),
      );
      const bytes = yield* download(url);
      const padded = yield* Effect.tryPromise({
        try: () => padCover(bytes),
        catch: (cause) =>
          new CoverError({
            message: `Could not pad the cover: ${describe(cause)}`,
          }),
      });
      // A fresh directory per run by default, so runs never share a file.
      const file = Option.isSome(out)
        ? out.value
        : join(
            yield* Effect.promise(() =>
              mkdtemp(join(tmpdir(), "meetup-cover-")),
            ),
            `meetup-cover-${fileSlug(slug)}.jpg`,
          );
      yield* Effect.promise(() => Bun.write(file, padded.bytes));
      yield* Console.log(
        `wrote ${file}: ${padded.width} × ${padded.height}, from ${url}`,
      );
    }).pipe(Effect.provide(Database.layer)),
).pipe(
  Command.withDescription("Write an evening's cover padded to 16:9 on black."),
);

Command.run(command, { version: "1.0.0" }).pipe(
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
);
