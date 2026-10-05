import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Config, Console, Effect, Redacted } from "effect";
import { Command, Flag } from "effect/cli";
import * as Database from "../src/database.ts";
import { encode } from "./encode.ts";
import {
  encodeKey,
  findOversized,
  type Media,
  reencode,
  type Reencoded,
} from "../src/reencode.ts";

/**
 * Re-encodes every image on the media origin larger than --over megabytes
 * (8 by default; the Images binding reads at most 20) and points its row at
 * the new, smaller object (see src/reencode.ts). Originals stay in the
 * bucket, untouched.
 *
 *   bun run reencode --dry-run   fetch, encode and report; store and write nothing
 *   bun run reencode             the same, stored and written
 *
 * --record <file> writes what it did as JSON (old and new keys, bytes and
 * sizes). Safe to run again: what it already did is not a candidate.
 *
 * DATABASE_URL (the database owner's connection string), MEDIA_UPLOAD_URL and
 * MEDIA_UPLOAD_TOKEN (the upload Worker the app stores media through) come
 * from the environment only; .env files are not read. Pass them without
 * printing them, e.g.
 *
 *   DATABASE_URL=$(bunx neonctl@latest connection-string br-round-dust-a6avtg0r \
 *     --project-id wispy-sea-75401301 --role-name neondb_owner --database-name neondb) \
 *   MEDIA_UPLOAD_URL=… MEDIA_UPLOAD_TOKEN=… bun run reencode --dry-run
 */

const origin = "https://media.allthings.dev";

const megabytes = 1_000_000;

const dryRunFlag = Flag.Boolean("dry-run").pipe(
  Flag.withDescription("Fetch, encode and report; store and write nothing."),
  Flag.withDefault(false),
);

const overFlag = Flag.Finite("over").pipe(
  Flag.withDescription("Re-encode images larger than this many megabytes."),
  Flag.withDefault(8),
);

const recordFlag = Flag.String("record").pipe(
  Flag.withDescription("Write what was done to this file, as JSON."),
  Flag.optional,
);

/** The media origin, and the upload Worker behind it, over HTTP. */
const httpMedia = (uploadUrl: string, token: Redacted.Redacted): Media => ({
  size: async (url) => {
    const response = await fetch(url, { method: "HEAD" });
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error(`HEAD ${url}: ${response.status}`);
    const length = response.headers.get("content-length");
    return length === null ? undefined : Number(length);
  },
  get: async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`GET ${url}: ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  },
  put: async (key, bytes, contentType) => {
    const response = await fetch(`${uploadUrl}/${encodeKey(key)}`, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${Redacted.value(token)}`,
        "content-type": contentType,
      },
      body: bytes,
    });
    if (response.status === 409) return "exists";
    if (!response.ok) throw new Error(`PUT ${key}: ${response.status}`);
    return "created";
  },
});

const mb = (bytes: number) => `${(bytes / megabytes).toFixed(1)} MB`;

const line = (done: Reencoded) =>
  `${done.object}: ${done.oldKey} (${mb(done.oldBytes)}, ${done.oldSize}) → ${done.newKey} (${mb(done.newBytes)}, ${done.newSize})`;

const command = Command.make(
  "reencode",
  { dryRun: dryRunFlag, over: overFlag, record: recordFlag },
  ({ dryRun, over, record }) =>
    Effect.gen(function* () {
      const uploadUrl = (yield* Config.String("MEDIA_UPLOAD_URL")).replace(
        /\/+$/,
        "",
      );
      const token = yield* Config.Redacted("MEDIA_UPLOAD_TOKEN");
      const media = httpMedia(uploadUrl, token);
      const candidates = yield* findOversized(media, origin, over * megabytes);
      yield* Console.log(
        `${candidates.length} images over ${over} MB${dryRun ? " (dry run)" : ""}`,
      );
      const done: Array<Reencoded> = [];
      const failed: Array<string> = [];
      // One at a time: a decoded 24-megapixel photo takes about 100 MB.
      for (const candidate of candidates) {
        yield* reencode(candidate, { media, encode, origin, dryRun }).pipe(
          Effect.tap((result) =>
            Effect.sync(() => done.push(result)).pipe(
              Effect.andThen(Console.log(line(result))),
            ),
          ),
          Effect.catchTag("ReencodeError", (error) =>
            Effect.sync(() => failed.push(error.key)).pipe(
              Effect.andThen(
                Console.error(`failed: ${error.key} ${error.reason}`),
              ),
            ),
          ),
        );
      }
      const before = done.reduce((sum, item) => sum + item.oldBytes, 0);
      const after = done.reduce((sum, item) => sum + item.newBytes, 0);
      yield* Console.log(
        `${done.length} re-encoded, ${failed.length} failed: ${mb(before)} → ${mb(after)}`,
      );
      if (record._tag === "Some") {
        yield* Effect.promise(() =>
          Bun.write(record.value, `${JSON.stringify(done, null, 2)}\n`),
        );
      }
      if (failed.length > 0) {
        yield* Effect.fail(
          new Error(`${failed.length} images failed: ${failed.join(", ")}`),
        );
      }
    }).pipe(Effect.provide(Database.layer)),
).pipe(
  Command.withDescription(
    "Re-encode oversized originals on the media origin under new keys.",
  ),
);

Command.run(command, { version: "1.0.0" }).pipe(
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
);
