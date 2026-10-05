import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Console, DateTime, Effect, Layer, Option, Schema } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { FetchHttpClient } from "effect/http";
import * as Database from "../src/database.ts";
import { type AddPostResult, addPost, BackfillFile } from "../src/posts/add.ts";
import { PostSources } from "../src/posts/sources.ts";
import { EventPostWriter } from "../src/posts/store.ts";

/**
 * Adds posts about events (src/posts/) to the Postgres at DATABASE_URL,
 * approved.
 *
 *   bun run posts add <event slug> <post url> [--dry-run] [--json]
 *     LinkedIn also needs --author-name and --text (and takes --author-url):
 *     nothing public serves its posts.
 *   bun run posts apply [file] [--dry-run]
 *     every { slug, url, authorName?, authorUrl?, text? } in the file
 *     (core/backfill/posts.json by default), in order.
 *
 * Adding a post that is already there changes nothing. DATABASE_URL comes
 * from the environment only; .env files are not read.
 */

const dryRunFlag = Flag.Boolean("dry-run").pipe(
  Flag.withDescription("Read the post and print it; write nothing."),
  Flag.withDefault(false),
);

const describe = (result: AddPostResult): string => {
  if (result._tag === "Added") return `added ${result.url}`;
  if (result._tag === "Exists") {
    return `already there: ${result.url} (${result.eventSlug}, ${result.status})`;
  }
  return `would add ${result.post.url}: ${result.post.authorName}, ${DateTime.formatIso(result.post.postedAt)}`;
};

const asJson = (result: AddPostResult) =>
  result._tag === "WouldAdd"
    ? {
        _tag: result._tag,
        post: {
          ...result.post,
          postedAt: DateTime.formatIso(result.post.postedAt),
        },
      }
    : result;

const layer = Layer.mergeAll(PostSources.layer, EventPostWriter.layer).pipe(
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(Database.layer),
);

const optionalText = (name: string, description: string) =>
  Flag.String(name).pipe(Flag.withDescription(description), Flag.optional);

const add = Command.make(
  "add",
  {
    slug: Argument.String("slug").pipe(
      Argument.withDescription("The event's slug."),
    ),
    url: Argument.String("url").pipe(
      Argument.withDescription("The post's URL on X, Bluesky or LinkedIn."),
    ),
    authorName: optionalText("author-name", "LinkedIn: the author's name."),
    authorUrl: optionalText("author-url", "LinkedIn: the author's profile."),
    text: optionalText("text", "LinkedIn: the post's text."),
    dryRun: dryRunFlag,
    json: Flag.Boolean("json").pipe(
      Flag.withDescription("Print the result as JSON."),
      Flag.withDefault(false),
    ),
  },
  ({ slug, url, authorName, authorUrl, text, dryRun, json }) =>
    addPost(slug, url, {
      dryRun,
      ...(Option.isSome(authorName) && Option.isSome(text)
        ? {
            manual: {
              authorName: authorName.value,
              authorUrl: Option.getOrNull(authorUrl),
              text: text.value,
            },
          }
        : {}),
    }).pipe(
      Effect.flatMap((result) =>
        Console.log(
          json ? JSON.stringify(asJson(result), null, 2) : describe(result),
        ),
      ),
      Effect.provide(layer),
    ),
).pipe(Command.withDescription("Add one post to an event, approved."));

const apply = Command.make(
  "apply",
  {
    file: Argument.String("file").pipe(
      Argument.withDescription("A JSON array of posts to add."),
      Argument.withDefault("backfill/posts.json"),
    ),
    dryRun: dryRunFlag,
  },
  ({ file, dryRun }) =>
    Effect.gen(function* () {
      const text = yield* Effect.promise(() =>
        Bun.file(new URL(`../${file}`, import.meta.url)).text(),
      );
      const entries = yield* Schema.decodeUnknownEffect(
        Schema.fromJsonString(BackfillFile),
      )(text);
      for (const entry of entries) {
        const result = yield* addPost(entry.slug, entry.url, {
          dryRun,
          ...(entry.authorName !== undefined && entry.text !== undefined
            ? {
                manual: {
                  authorName: entry.authorName,
                  authorUrl: entry.authorUrl ?? null,
                  text: entry.text,
                },
              }
            : {}),
        });
        yield* Console.log(`${entry.slug}: ${describe(result)}`);
      }
    }).pipe(Effect.provide(layer)),
).pipe(Command.withDescription("Add every post a backfill file lists."));

const posts = Command.make("posts").pipe(
  Command.withDescription("Posts about events."),
  Command.withSubcommands([add, apply]),
);

Command.run(posts, { version: "1.0.0" }).pipe(
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
);
