import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Config, Console, Effect, Redacted } from "effect";
import { Command, Flag } from "effect/cli";
import {
  answeredQuery,
  formatReport,
  type RequestsStage,
  type Row,
  statusQuery,
  top404Query,
} from "../src/request-queries.ts";

/**
 * What reached the Web Worker, from its one anonymous data point per
 * request (src/request-metrics.ts): the statuses, what answered (the page
 * store's hit rate among them) and the paths that answered 404 most. It
 * reads Analytics Engine's SQL API with a token that may only read the
 * account's analytics ("allthings analytics read"), passed without
 * printing it:
 *
 *   CLOUDFLARE_API_TOKEN=$(op read "op://allthings/allthings analytics read/credential") \
 *     bun run requests                  # prod, the last 7 days
 *   … bun run requests --days 1 --limit 50
 *   … bun run requests --preview        # every other stage's points
 */

/** The allthings Cloudflare account (infra/README.md, "Accounts and stages"). */
const ACCOUNT = "af627f300cd00c4dca56aacf05bea050";

const query = (token: Redacted.Redacted, sql: string) =>
  Effect.tryPromise(async () => {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/analytics_engine/sql`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${Redacted.value(token)}` },
        body: sql,
      },
    );
    const text = await response.text();
    if (!response.ok) {
      throw new Error(
        `Analytics Engine answered ${response.status}: ${text.slice(0, 300)}`,
      );
    }
    const body = JSON.parse(text) as { readonly data?: ReadonlyArray<Row> };
    return body.data ?? [];
  });

const command = Command.make(
  "requests",
  {
    days: Flag.Int("days").pipe(
      Flag.withDescription("Read the last this many days (at most 90)."),
      Flag.filter(
        (days) => days >= 1 && days <= 90,
        (days) => `--days must be 1 to 90, not ${days}`,
      ),
      Flag.withDefault(7),
    ),
    limit: Flag.Int("limit").pipe(
      Flag.withDescription("List at most this many 404 paths."),
      Flag.filter(
        (limit) => limit >= 1 && limit <= 1000,
        (limit) => `--limit must be 1 to 1000, not ${limit}`,
      ),
      Flag.withDefault(20),
    ),
    preview: Flag.Boolean("preview").pipe(
      Flag.withDescription(
        "Read every stage but prod (PR previews, staging, personal stages).",
      ),
      Flag.withDefault(false),
    ),
  },
  ({ days, limit, preview }) =>
    Effect.gen(function* () {
      const token = yield* Config.Redacted("CLOUDFLARE_API_TOKEN");
      const stage: RequestsStage = preview ? "preview" : "prod";
      const [statuses, answered, notFound] = yield* Effect.all(
        [
          query(token, statusQuery(stage, days)),
          query(token, answeredQuery(stage, days)),
          query(token, top404Query(stage, days, limit)),
        ],
        { concurrency: 3 },
      );
      yield* Console.log(
        formatReport({ stage, days }, { statuses, answered, notFound }),
      );
    }),
).pipe(
  Command.withDescription(
    "Report the Web Worker's requests: statuses, page store hits, top 404s.",
  ),
);

Command.run(command, { version: "1.0.0" }).pipe(
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
);
