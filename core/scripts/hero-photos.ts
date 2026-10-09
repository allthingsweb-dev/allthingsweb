import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Console, Effect } from "effect";
import { Command } from "effect/cli";
import * as Database from "../src/database.ts";
import { heroPhotoProblems, heroPhotos } from "../src/hero-photos.ts";

/**
 * Fails when home can't show one of the hand-picked hero photos
 * (core/backfill/hero-photos.json, src/hero-photos.ts): an image that
 * isn't on media.allthings.dev, isn't attached to the evening it names, or
 * whose evening is a draft, someone else's, or still ahead. CI runs it on
 * pull requests that change the photos, on main, and weekly
 * (.github/workflows/hero-photos.yaml).
 *
 *   bun run hero-photos
 *
 * DATABASE_URL comes from the environment only; .env files are not read.
 * It only reads: production's read-only site_reader role is enough.
 */

const photoOrigin = "https://media.allthings.dev";

const command = Command.make("hero-photos", {}, () =>
  Effect.gen(function* () {
    const problems = yield* heroPhotoProblems(heroPhotos, photoOrigin);
    if (problems.length > 0) {
      yield* Effect.fail(
        new Error(
          `Home can't show these hero photos (core/backfill/hero-photos.json):\n${problems.join("\n")}`,
        ),
      );
    }
    yield* Console.log(
      `Home can show all ${heroPhotos.length} hero photos, in order.`,
    );
  }).pipe(Effect.provide(Database.layer)),
).pipe(
  Command.withDescription(
    "Check the hand-picked hero photos against the database.",
  ),
);

Command.run(command, { version: "1.0.0" }).pipe(
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
);
