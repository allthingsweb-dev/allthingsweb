import { BunRuntime, BunServices } from "@effect/platform-bun";
import {
  Console,
  DateTime,
  Duration,
  Effect,
  Layer,
  Option,
  Schema,
} from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { FetchHttpClient } from "effect/http";
import * as Database from "../src/database.ts";
import {
  type AddPostResult,
  addPost,
  addPosts,
  BackfillFile,
  postUrlsIn,
} from "../src/posts/add.ts";
import {
  CandidateSearches,
  eveningSignals,
  findCandidates,
  xBrowserSearches,
  xCostPerPost,
} from "../src/posts/candidates.ts";
import {
  pendingJson,
  pendingPosts,
  movePost,
  setPostStatus,
} from "../src/posts/review.ts";
import { PostSources } from "../src/posts/sources.ts";
import { EventPostWriter } from "../src/posts/store.ts";
import { sweep, type SweepReport, sweepWindow } from "../src/posts/sweep.ts";

/**
 * Posts about events (src/posts/) in the Postgres at DATABASE_URL.
 *
 *   bun run posts add <event slug> <post url> [--dry-run] [--json]
 *     adds one, approved. LinkedIn also needs --author-name and --text (and
 *     takes --author-url): nothing public serves its posts.
 *   bun run posts add <event slug> --from <file> [--dry-run] [--json]
 *     every X or Bluesky post URL in the file, each once, as pending: posts
 *     a search of X in the browser found, for review like a sweep's.
 *   bun run posts apply [file] [--dry-run]
 *     every { slug, url, authorName?, authorUrl?, text? } in the file
 *     (core/backfill/posts.json by default), in order, approved.
 *   bun run posts find [--slug <slug>]… [--past] [--dry-run] [--json]
 *     searches Bluesky (and X, with X_BEARER_TOKEN from 1Password's
 *     "allthings X app") for posts about evenings, the last week's by
 *     default, and adds those that score enough as pending.
 *   bun run posts sweep <slug or short link> [--every <minutes>] [--dry-run] [--json]
 *     find for one evening, before it starts too, then what is new and what
 *     waits for review; --every sweeps again until its window closes.
 *   bun run posts x-searches <slug or short link> [--json]
 *     the searches to run on x.com in a browser for posts about it.
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
  Layer.provide(Database.scriptLayer),
);

/** What a search needs: the post tools, the searches, and the database itself. */
const candidatesLayer = Layer.mergeAll(
  PostSources.layer,
  EventPostWriter.layer,
  CandidateSearches.layer,
).pipe(
  Layer.provideMerge(FetchHttpClient.layer),
  Layer.provideMerge(Database.scriptLayer),
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
      Argument.optional,
    ),
    from: Flag.String("from").pipe(
      Flag.withDescription(
        "A file of post URLs, such as an X search's: each added once, as pending.",
      ),
      Flag.optional,
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
  ({ slug, url: given, from, authorName, authorUrl, text, dryRun, json }) =>
    Option.isSome(from)
      ? Option.isSome(given)
        ? Effect.fail(new Error("Give a post URL or --from <file>, not both."))
        : addFrom(slug, from.value, { dryRun, json })
      : Option.isNone(given)
        ? Effect.fail(new Error("Give a post URL, or --from <file>."))
        : addOne(slug, given.value, {
            authorName,
            authorUrl,
            text,
            dryRun,
            json,
          }),
).pipe(
  Command.withDescription(
    "Add one post to an event, approved; or every post URL in a file, as pending.",
  ),
);

/** Every post URL in `file`, each once, added to `slug` as pending. */
function addFrom(
  slug: string,
  file: string,
  options: { readonly dryRun: boolean; readonly json: boolean },
) {
  return Effect.gen(function* () {
    const text = yield* Effect.tryPromise({
      try: () => Bun.file(file).text(),
      catch: (cause) =>
        new Error(`${file} could not be read: ${String(cause)}`),
    });
    const { urls, ignored } = postUrlsIn(text);
    const results = yield* addPosts(slug, urls, {
      dryRun: options.dryRun,
      status: "pending",
    });
    if (options.json) {
      yield* Console.log(
        JSON.stringify(
          {
            ignored,
            results: results.map((r) =>
              "failed" in r ? r : { url: r.url, result: asJson(r.result) },
            ),
          },
          null,
          2,
        ),
      );
      return;
    }
    for (const r of results) {
      yield* Console.log(
        "failed" in r ? `failed ${r.url}: ${r.failed}` : describe(r.result),
      );
    }
    for (const url of ignored) yield* Console.log(`not a post: ${url}`);
    yield* Console.log(
      `${urls.length} posts in ${file}; review them with: bun run posts pending --slug ${slug}`,
    );
  }).pipe(Effect.provide(layer));
}

/** One post, added approved. */
function addOne(
  slug: string,
  url: string,
  {
    authorName,
    authorUrl,
    text,
    dryRun,
    json,
  }: {
    readonly authorName: Option.Option<string>;
    readonly authorUrl: Option.Option<string>;
    readonly text: Option.Option<string>;
    readonly dryRun: boolean;
    readonly json: boolean;
  },
) {
  return addPost(slug, url, {
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
  );
}

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
        "Send at most this many requests in the run, 0 or more (X bills each post a search returns).",
      ),
      Flag.filter(
        (max) => max >= 0,
        (max) => `--max-requests must be 0 or more, not ${max}`,
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
      // X bills each post its search returns; what this run kept, priced: a
      // floor, since X also bills posts the finder drops (no author handle).
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
          `X: ${xPosts} posts kept, so at least $${(xPosts * xCostPerPost).toFixed(2)} at pay-per-use.`,
        );
      }
    }).pipe(Effect.provide(candidatesLayer)),
).pipe(
  Command.withDescription(
    "Search Bluesky (and X, with X_BEARER_TOKEN) for posts about evenings; add those that score enough as pending. Recent evenings by default.",
  ),
);

const day = (instant: DateTime.Utc) => DateTime.formatIso(instant).slice(0, 10);

/** A sweep, as the agent running the evening reads it. */
const sweepText = (report: SweepReport, at: DateTime.Utc) =>
  [
    `${report.slug}, swept ${DateTime.formatIso(at)}: posts from ${day(report.window.since)} to ${day(report.window.until)} (${Object.entries(
      report.searched,
    )
      .map(([platform, n]) => `${platform}: ${n}`)
      .join("; ")})`,
    `New (${report.added.length}):`,
    ...report.added.map(
      (c) =>
        `  ${c.score} ${c.url} → ${c.outcome}\n    ${c.reasons.join(", ")}`,
    ),
    `Found again: ${report.known.length}`,
    `Waiting for review (${report.waiting.length}):`,
    ...report.waiting.map(
      (post) =>
        `  ${post.url}\n    ${post.authorName} (${post.authorHandle ?? "-"}), ${DateTime.formatIso(post.postedAt)}\n    ${post.text.replace(/\s+/g, " ").slice(0, 200)}`,
    ),
    ...(report.waiting.length === 0
      ? []
      : [
          "Approve one with: bun run posts approve <post url>; hide one with: bun run posts hide <post url>",
        ]),
  ].join("\n");

const sweepJson = (report: SweepReport, at: DateTime.Utc) => ({
  ...report,
  sweptAt: DateTime.formatIso(at),
  window: {
    since: DateTime.formatIso(report.window.since),
    until: DateTime.formatIso(report.window.until),
  },
  waiting: report.waiting.map(pendingJson),
});

const sweepCommand = Command.make(
  "sweep",
  {
    slug: Argument.String("slug").pipe(
      Argument.withDescription("The evening's slug or short link."),
    ),
    every: Flag.Int("every").pipe(
      Flag.withDescription(
        "Sweep again every this many minutes, 1 or more, until the evening's window closes.",
      ),
      Flag.filter(
        (minutes) => minutes >= 1,
        (minutes) => `--every must be 1 or more, not ${minutes}`,
      ),
      Flag.optional,
    ),
    dryRun: dryRunFlag,
    json: jsonFlag,
  },
  ({ slug, every, dryRun, json }) =>
    Effect.gen(function* () {
      const { window } = yield* sweepWindow(slug);
      for (;;) {
        const report = yield* sweep(slug, { dryRun });
        const at = yield* DateTime.now;
        yield* Console.log(
          json
            ? JSON.stringify(sweepJson(report, at), null, 2)
            : sweepText(report, at),
        );
        if (Option.isNone(every)) return;
        const next = DateTime.addDuration(at, Duration.minutes(every.value));
        if (DateTime.isGreaterThan(next, window.until)) {
          yield* Console.log(
            `The window closed ${DateTime.formatIso(window.until)}: no more sweeps.`,
          );
          return;
        }
        yield* Effect.sleep(Duration.minutes(every.value));
      }
    }).pipe(Effect.provide(candidatesLayer)),
).pipe(
  Command.withDescription(
    "Search for posts about one evening, before it starts too; add those that score enough as pending; say what is new and what waits for review.",
  ),
);

const xSearches = Command.make(
  "x-searches",
  {
    slug: Argument.String("slug").pipe(
      Argument.withDescription("The evening's slug or short link."),
    ),
    json: jsonFlag,
  },
  ({ slug, json }) =>
    Effect.gen(function* () {
      const signals = yield* eveningSignals(slug).pipe(
        Effect.flatMap((found) =>
          found === null
            ? Effect.fail(
                new Error(
                  `No published evening has the slug or short link ${slug}`,
                ),
              )
            : Effect.succeed(found),
        ),
      );
      const searches = xBrowserSearches(signals);
      yield* Console.log(
        json
          ? JSON.stringify({ slug: signals.slug, searches }, null, 2)
          : [
              ...searches.map(
                (s, index) =>
                  `${index + 1}. ${s.what}\n   ${s.query}\n   ${s.url}`,
              ),
              `Put the posts' URLs in a file, one a line, then: bun run posts add ${signals.slug} --from <file>`,
            ].join("\n"),
      );
    }).pipe(Effect.provide(candidatesLayer)),
).pipe(
  Command.withDescription(
    "The searches to run on x.com in a browser for posts about one evening.",
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
    }).pipe(Effect.provide(Database.scriptLayer)),
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
      }).pipe(Effect.provide(Database.scriptLayer)),
  ).pipe(
    Command.withDescription(
      name === "approve"
        ? "Approve a post: it shows on its evening's page."
        : "Hide a post: it never shows.",
    ),
  );

const move = Command.make(
  "move",
  {
    url: Argument.String("url").pipe(
      Argument.withDescription("The post's URL."),
    ),
    slug: Argument.String("slug").pipe(
      Argument.withDescription("The evening it is about."),
    ),
    json: jsonFlag,
  },
  ({ url, slug, json }) =>
    Effect.gen(function* () {
      const moved = yield* movePost(url, slug);
      yield* Console.log(
        json
          ? JSON.stringify(moved, null, 2)
          : moved._tag === "Moved"
            ? `${moved.url}: ${moved.from} → ${moved.to} (still ${moved.status})`
            : moved._tag === "Unchanged"
              ? `${moved.url}: already on ${moved.eventSlug}`
              : moved._tag === "NoSuchEvening"
                ? `${moved.url}: no evening has the slug ${moved.slug}`
                : moved._tag === "Ambiguous"
                  ? `${moved.url}: several stored posts match, name one by its URL: ${moved.matches.join(", ")}`
                  : `${moved.url}: no stored post`,
      );
      // As JSON, every outcome is an answer (the MCP tool shows it); in
      // text, one that moved nothing it should have is a failure.
      if (
        !json &&
        (moved._tag === "NotFound" ||
          moved._tag === "NoSuchEvening" ||
          moved._tag === "Ambiguous")
      ) {
        yield* Effect.fail(new Error(`Did not move ${url}: ${moved._tag}`));
      }
    }).pipe(Effect.provide(Database.scriptLayer)),
).pipe(
  Command.withDescription(
    "Move a post to the evening it is about, keeping its status.",
  ),
);

const posts = Command.make("posts").pipe(
  Command.withDescription("Posts about events."),
  Command.withSubcommands([
    add,
    apply,
    find,
    sweepCommand,
    xSearches,
    pending,
    statusCommand("approve"),
    statusCommand("hide"),
    move,
  ]),
);

Command.run(posts, { version: "1.0.0" }).pipe(
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
);
