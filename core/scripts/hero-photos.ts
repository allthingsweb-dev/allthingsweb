import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Console, Effect } from "effect";
import { Command } from "effect/cli";
import * as Database from "../src/database.ts";
import { facePicks, faceProblems } from "../src/faces.ts";
import {
  heroPhotoProblems,
  heroPhotos,
  wallPhotos,
} from "../src/hero-photos.ts";

/**
 * Fails when a page can't show one of its hand-picked pictures: home's hero
 * photos (core/backfill/hero-photos.json) and the home lab's wall
 * (core/backfill/wall-photos.json), held to the rules in
 * src/hero-photos.ts, and the lab's faces (core/backfill/faces.json), held
 * to those in src/faces.ts. A photo must be an image on media.allthings.dev
 * attached to the evening it names, and that evening one of ours,
 * published and over; a face must be a profile with a photo there who has
 * been on stage at one of those evenings. CI runs it on pull requests that
 * change the picks or how they're read, on main, and weekly
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
    const lists = [
      {
        file: "core/backfill/hero-photos.json",
        count: heroPhotos.length,
        problems: yield* heroPhotoProblems(heroPhotos, photoOrigin),
      },
      {
        file: "core/backfill/wall-photos.json",
        count: wallPhotos.length,
        problems: yield* heroPhotoProblems(wallPhotos, photoOrigin),
      },
      {
        file: "core/backfill/faces.json",
        count: facePicks.length,
        problems: yield* faceProblems(facePicks, photoOrigin),
      },
    ];
    const failing = lists.filter((list) => list.problems.length > 0);
    if (failing.length > 0) {
      yield* Effect.fail(
        new Error(
          failing
            .map(
              (list) =>
                `These can't be shown (${list.file}):\n${list.problems.join("\n")}`,
            )
            .join("\n\n"),
        ),
      );
    }
    for (const list of lists) {
      yield* Console.log(`All ${list.count} of ${list.file} can be shown.`);
    }
  }).pipe(Effect.provide(Database.layer)),
).pipe(
  Command.withDescription(
    "Check the hand-picked photos and faces against the database.",
  ),
);

Command.run(command, { version: "1.0.0" }).pipe(
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
);
