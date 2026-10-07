import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Console, DateTime, Effect, Layer, Option, Schema } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { FetchHttpClient } from "effect/http";
import * as Database from "../src/database.ts";
import { type AddPostResult, addPost, BackfillFile } from "../src/posts/add.ts";
import {
  CandidateSearches,
  findCandidates,
  xCostPerPost,
} from "../src/posts/candidates.ts";
import {
  pendingJson,
  pendingPosts,
  setPostStatus,
} from "../src/posts/review.ts";
import { PostSources } from "../src/posts/sources.ts";
import { EventPostWriter } from "../src/posts/store.ts";

/**
 * Posts about events (src/posts/) in the Postgres at DATABASE_URL.
 *
 *   bun run posts add <event slug> <post url> [--dry-run] [--json]
 *     adds one, approved. LinkedIn also needs --author-name and --text (and
 *     takes --author-url): nothing public serves its posts.
 *   bun run posts apply [file] [--dry-run]
 *     every { slug, url, authorName?, authorUrl?, text? } in the file
 *     (core/backfill/posts.json by default), in order, approved.
 *   bun run posts find [--slug <slug>]… [--past] [--dry-run] [--json]
 *     searches Bluesky (and X, with X_BEARER_TOKEN from 1Password's
 *     "allthings X app") for posts about evenings, the last week's by
 *     default, and adds those that score enough as pending.
 *   bun run posts pending [--slug <slug>] [--json]
 *   bun run posts approve <post url> | bun run posts hide <post url>
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

/** What a search needs: the post tools, the searches, and the database itself. */
const candidatesLayer = Layer.mergeAll(
  PostSources.layer,
  EventPostWriter.layer,
  CandidateSearches.layer,
).pipe(
  Layer.provideMerge(FetchHttpClient.layer),
  Layer.provideMerge(Database.layer),
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

const jsonFlag = Flag.Boolean("json").pipe(
  Flag.withDescription("Print the result as JSON."),
  Flag.withDefault(false),
);

const find = Command.make(
  "find",
  {
    slug: Flag.String("slug").pipe(
      Flag.withDescription("Search this evening; repeat for more."),
      Flag.atLeast(0),
    ),
    past: Flag.Boolean("past").pipe(
      Flag.withDescription("Search every published evening that has started."),
      Flag.withDefault(false),
    ),
    maxRequests: Flag.Int("max-requests").pipe(
      Flag.withDescription(
        "Send at most this many requests in the run (X bills each post a search returns).",
      ),
      Flag.optional,
    ),
    dryRun: dryRunFlag,
    json: jsonFlag,
  },
  ({ slug, past, maxRequests, dryRun, json }) =>
    Effect.gen(function* () {
      const reports = yield* findCandidates({
        scope:
          slug.length > 0
            ? { _tag: "Slugs", slugs: slug }
            : past
              ? { _tag: "Past" }
              : { _tag: "Recent", within: "7 days" },
        dryRun,
        ...(Option.isSome(maxRequests)
          ? { maxRequests: maxRequests.value }
          : {}),
      });
      // X bills each post its search returns; what this run read, priced.
      const xPosts = reports.reduce(
        (sum, report) =>
          sum +
          (typeof report.searched["x"] === "number" ? report.searched["x"] : 0),
        0,
      );
      yield* Console.log(
        json
          ? JSON.stringify(reports, null, 2)
          : reports
              .map((report) =>
                [
                  `${report.slug} (${Object.entries(report.searched)
                    .map(([platform, n]) => `${platform}: ${n}`)
                    .join("; ")})`,
                  ...report.candidates.map(
                    (c) =>
                      `  ${c.score} ${c.url} → ${c.outcome}\n    ${c.reasons.join(", ")}`,
                  ),
                ].join("\n"),
              )
              .join("\n"),
      );
      if (!json) {
        yield* Console.log(
          `X: ${xPosts} posts read, about $${(xPosts * xCostPerPost).toFixed(2)} at pay-per-use.`,
        );
      }
    }).pipe(Effect.provide(candidatesLayer)),
).pipe(
  Command.withDescription(
    "Search Bluesky (and X, with X_BEARER_TOKEN) for posts about evenings; add those that score enough as pending. Recent evenings by default.",
  ),
);

const pending = Command.make(
  "pending",
  {
    slug: Flag.String("slug").pipe(
      Flag.withDescription("Only this evening's."),
      Flag.optional,
    ),
    json: jsonFlag,
  },
  ({ slug, json }) =>
    Effect.gen(function* () {
      const rows = yield* pendingPosts(Option.getOrUndefined(slug));
      yield* Console.log(
        json
          ? JSON.stringify(rows.map(pendingJson), null, 2)
          : rows
              .map(
                (post) =>
                  `${post.eventSlug} ${post.url}\n  ${post.authorName} (${post.authorHandle ?? "-"}), ${DateTime.formatIso(post.postedAt)}\n  ${post.text.replace(/\s+/g, " ").slice(0, 200)}`,
              )
              .join("\n") || "No pending posts.",
      );
    }).pipe(Effect.provide(Database.layer)),
).pipe(Command.withDescription("List the posts waiting for review."));

const statusCommand = (name: "approve" | "hide") =>
  Command.make(
    name,
    {
      url: Argument.String("url").pipe(
        Argument.withDescription("The post's URL."),
      ),
      json: jsonFlag,
    },
    ({ url, json }) =>
      Effect.gen(function* () {
        const change = yield* setPostStatus(
          url,
          name === "approve" ? "approved" : "hidden",
        );
        yield* Console.log(
          json
            ? JSON.stringify(change, null, 2)
            : change._tag === "Changed"
              ? `${change.url} (${change.eventSlug}): ${change.from} → ${change.to}`
              : change._tag === "Unchanged"
                ? `${change.url}: already ${change.status}`
                : change._tag === "Ambiguous"
                  ? `${change.url}: several stored posts match, name one by its URL: ${change.matches.join(", ")}`
                  : `${change.url}: no stored post`,
        );
        // As JSON, a missing or ambiguous post is an answer like any other
        // (the MCP tools show it); in text, it is a failure the shell sees.
        if (change._tag === "NotFound" && !json) {
          yield* Effect.fail(new Error(`No stored post at ${url}`));
        }
        if (change._tag === "Ambiguous" && !json) {
          yield* Effect.fail(new Error(`Several stored posts match ${url}`));
        }
      }).pipe(Effect.provide(Database.layer)),
  ).pipe(
    Command.withDescription(
      name === "approve"
        ? "Approve a post: it shows on its evening's page."
        : "Hide a post: it never shows.",
    ),
  );

const posts = Command.make("posts").pipe(
  Command.withDescription("Posts about events."),
  Command.withSubcommands([
    add,
    apply,
    find,
    pending,
    statusCommand("approve"),
    statusCommand("hide"),
  ]),
);

Command.run(posts, { version: "1.0.0" }).pipe(
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
);
