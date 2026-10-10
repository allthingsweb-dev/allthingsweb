import { BunRuntime, BunServices } from "@effect/platform-bun";
import { basename } from "node:path";
import { Console, Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import * as Database from "../src/database.ts";
import { applyHostLinks, decodeHostLinksFile } from "../src/host-links.ts";
import { planHostLogos, setHostLogos } from "../src/host-logos.ts";
import { changeLines, type ImageFile } from "../src/image-columns.ts";
import { encode, placeholder } from "./encode.ts";
import { mediaOrigin, uploadMedia } from "./media.ts";
import { shellWord } from "./shell.ts";

/**
 * Hosting companies, in the Postgres at DATABASE_URL.
 *
 *   bun run hosts [file] --dry-run   apply their sourced links: do it, print it, roll back
 *   bun run hosts [file]             the same, committed
 *
 *   bun run hosts logo <company> --dark <file> --light <file> --dry-run
 *   bun run hosts logo <company> --dark <file> --light <file> --approve <token>
 *
 * The links are core/backfill/hosts.json (src/host-links.ts), applied in one
 * transaction.
 *
 * logo sets a company's two square logos (src/host-logos.ts), the one for
 * dark backgrounds and the one for light. <company> is its exact name or
 * its id. Each file is encoded as the photos are (upright, at most 4096
 * pixels, JPEG, or WebP where it is see-through, no metadata), stored
 * through the upload Worker under sponsors/<name>-<dark|light>-<id>, and
 * recorded in images. --dry-run encodes, reads and prints exactly what
 * would change, with its approval token, and stores and writes nothing.
 * --approve <token> makes exactly that change, or refuses it if anything
 * changed since. A logo it replaces loses its images row only when nothing
 * else uses it; its object stays in the bucket.
 *
 * DATABASE_URL (the studio's connection string for `logo`, the owner's
 * for applying the file: core's README, "The studio's connection"), MEDIA_UPLOAD_URL
 * and MEDIA_UPLOAD_TOKEN (the upload Worker, for --approve) come from the
 * environment only; .env files are not read.
 */

const applyLinks = Command.make(
  "hosts",
  {
    file: Argument.String("file").pipe(
      Argument.withDescription("The hosts' links, with their sources."),
      Argument.withDefault("backfill/hosts.json"),
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
      const links = yield* decodeHostLinksFile(text);
      const lines = yield* applyHostLinks(links, dryRun);
      yield* Console.log(lines.join("\n"));
    }).pipe(Effect.provide(Database.layer)),
).pipe(Command.withDescription("Apply hosting companies' sourced links."));

const read = (path: string) =>
  Effect.tryPromise({
    try: async (): Promise<ImageFile> => ({
      name: basename(path),
      bytes: await Bun.file(path).bytes(),
    }),
    catch: (cause) => new Error(`${path} could not be read: ${String(cause)}`),
  });

const logo = Command.make(
  "logo",
  {
    company: Argument.String("company").pipe(
      Argument.withDescription(
        "The hosting company: its exact name, or its id.",
      ),
    ),
    dark: Flag.String("dark").pipe(
      Flag.withDescription("The logo for dark backgrounds."),
    ),
    light: Flag.String("light").pipe(
      Flag.withDescription("The logo for light backgrounds."),
    ),
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
  ({ company, dark, light, dryRun, approve, json }) =>
    Effect.gen(function* () {
      // Exactly one: read what would change, or make the change approved.
      if (dryRun === Option.isSome(approve)) {
        return yield* Effect.fail(
          new Error(
            "Give --dry-run to read what would change, or --approve <token> to make exactly that change.",
          ),
        );
      }
      const files = { dark: yield* read(dark), light: yield* read(light) };
      if (Option.isNone(approve)) {
        const { change, token } = yield* planHostLogos(company, files, {
          encode,
          placeholder,
          origin: mediaOrigin,
        });
        return yield* Console.log(
          json
            ? JSON.stringify({ dryRun: true, change, token }, null, 2)
            : [
                `${change.row.name} (${change.row.id}): its logos`,
                ...changeLines(change, false),
                `approval token: ${token}`,
                `Nothing was stored or changed. To make exactly this change: bun run hosts logo ${shellWord(company)} --dark ${shellWord(dark)} --light ${shellWord(light)} --approve ${token}`,
              ].join("\n"),
        );
      }
      const change = yield* setHostLogos(company, files, approve.value, {
        media: yield* uploadMedia,
        encode,
        placeholder,
        origin: mediaOrigin,
      });
      return yield* Console.log(
        json
          ? JSON.stringify({ dryRun: false, change }, null, 2)
          : [
              `Set ${change.row.name}'s logos (${change.row.id}).`,
              ...changeLines(change, true),
            ].join("\n"),
      );
    }).pipe(Effect.provide(Database.layer)),
).pipe(
  Command.withDescription(
    "Set a hosting company's dark and light logos from files, exactly as a dry run showed it.",
  ),
);

Command.run(applyLinks.pipe(Command.withSubcommands([logo])), {
  version: "1.0.0",
}).pipe(Effect.provide(BunServices.layer), BunRuntime.runMain);
