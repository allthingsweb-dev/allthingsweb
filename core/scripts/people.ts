import { BunRuntime, BunServices } from "@effect/platform-bun";
import { basename } from "node:path";
import { Console, Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import * as Database from "../src/database.ts";
import { changeLines } from "../src/image-columns.ts";
import { applyPeople, decodePeopleFile } from "../src/people-enrichment.ts";
import { planProfilePhoto, setProfilePhoto } from "../src/profile-photo.ts";
import { encode, placeholder } from "./encode.ts";
import { mediaOrigin, uploadMedia } from "./media.ts";
import { shellWord } from "./shell.ts";

/**
 * People's profiles, in the Postgres at DATABASE_URL.
 *
 *   bun run people [file] --dry-run   apply their sourced facts: do it, print it, roll back
 *   bun run people [file]             the same, committed
 *
 *   bun run people photo <profile> <file> --dry-run
 *   bun run people photo <profile> <file> --approve <token>
 *
 * The facts are core/backfill/people.json (src/people-enrichment.ts):
 * titles, bios, links and photos, applied in one transaction.
 *
 * photo sets a profile's photo from a local file (src/profile-photo.ts).
 * <profile> is its id, its slug (as /people/<slug> has it) or its exact
 * name. The file is encoded as the photos are (upright, at most 4096
 * pixels, JPEG, or WebP where it is see-through, no metadata), stored
 * through the upload Worker under profiles/<name>-<id>, and recorded in
 * images. --dry-run encodes, reads and prints exactly what would change,
 * with its approval token, and stores and writes nothing. --approve <token>
 * makes exactly that change, or refuses it if anything changed since. A
 * photo it replaces loses its images row only when nothing else uses it;
 * its object stays in the bucket.
 *
 * DATABASE_URL (the studio's connection string for `photo`, the owner's
 * for applying the file: core's README, "The studio's connection"), MEDIA_UPLOAD_URL
 * and MEDIA_UPLOAD_TOKEN (the upload Worker, for --approve) come from the
 * environment only; .env files are not read.
 */

const applyFacts = Command.make(
  "people",
  {
    file: Argument.String("file").pipe(
      Argument.withDescription("The people's facts, with their sources."),
      Argument.withDefault("backfill/people.json"),
    ),
    dryRun: Flag.Boolean("dry-run").pipe(
      Flag.withDescription("Do everything, print it, then roll it back."),
      Flag.withDefault(false),
    ),
  },
  ({ file, dryRun }) =>
    Effect.gen(function* () {
      const text = yield* Effect.promise(() =>
        Bun.file(new URL(`../${file}`, import.meta.url)).text(),
      );
      const links = yield* decodePeopleFile(text);
      const lines = yield* applyPeople(links, dryRun);
      yield* Console.log(lines.join("\n"));
    }).pipe(Effect.provide(Database.layer)),
).pipe(
  Command.withDescription(
    "Fill people's profiles from sourced facts; a filled value is replaced only where the file names it as stale.",
  ),
);

const photo = Command.make(
  "photo",
  {
    profile: Argument.String("profile").pipe(
      Argument.withDescription(
        "The profile: its id, its slug, or its exact name.",
      ),
    ),
    file: Argument.String("file").pipe(Argument.withDescription("The photo.")),
    dryRun: Flag.Boolean("dry-run").pipe(
      Flag.withDescription(
        "Print exactly what would change, and its approval token; store and write nothing.",
      ),
      Flag.withDefault(false),
    ),
    approve: Flag.String("approve").pipe(
      Flag.withDescription(
        "The token --dry-run printed: make exactly that change, or refuse if anything changed since.",
      ),
      Flag.optional,
    ),
    json: Flag.Boolean("json").pipe(
      Flag.withDescription("Print the result as JSON."),
      Flag.withDefault(false),
    ),
  },
  ({ profile, file, dryRun, approve, json }) =>
    Effect.gen(function* () {
      // Exactly one: read what would change, or make the change approved.
      if (dryRun === Option.isSome(approve)) {
        return yield* Effect.fail(
          new Error(
            "Give --dry-run to read what would change, or --approve <token> to make exactly that change.",
          ),
        );
      }
      const image = {
        name: basename(file),
        bytes: yield* Effect.tryPromise({
          try: () => Bun.file(file).bytes(),
          catch: (cause) =>
            new Error(`${file} could not be read: ${String(cause)}`),
        }),
      };
      if (Option.isNone(approve)) {
        const { change, token } = yield* planProfilePhoto(profile, image, {
          encode,
          placeholder,
          origin: mediaOrigin,
        });
        return yield* Console.log(
          json
            ? JSON.stringify({ dryRun: true, change, token }, null, 2)
            : [
                `${change.row.name} (${change.row.id}): their photo`,
                ...changeLines(change, false),
                `approval token: ${token}`,
                `Nothing was stored or changed. To make exactly this change: bun run people photo ${shellWord(profile)} ${shellWord(file)} --approve ${token}`,
              ].join("\n"),
        );
      }
      const change = yield* setProfilePhoto(profile, image, approve.value, {
        media: yield* uploadMedia,
        encode,
        placeholder,
        origin: mediaOrigin,
      });
      return yield* Console.log(
        json
          ? JSON.stringify({ dryRun: false, change }, null, 2)
          : [
              `Set ${change.row.name}'s photo (${change.row.id}).`,
              ...changeLines(change, true),
            ].join("\n"),
      );
    }).pipe(Effect.provide(Database.layer)),
).pipe(
  Command.withDescription(
    "Set a profile's photo from a file, exactly as a dry run showed it.",
  ),
);

Command.run(applyFacts.pipe(Command.withSubcommands([photo])), {
  version: "1.0.0",
}).pipe(Effect.provide(BunServices.layer), BunRuntime.runMain);
