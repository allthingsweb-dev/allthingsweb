/**
 * Copies the media bucket (allthings-media) from the account it lives in now
 * into the allthings account, for media.allthings.dev to switch to when the
 * allthings.dev zone moves (see src/media-copy.ts for how each copy is
 * checked). It never overwrites or deletes: the source keeps every original,
 * and a rerun copies only what the target still lacks.
 *
 *   bun scripts/copy-media.ts plan     list both buckets and say what a copy would do
 *   bun scripts/copy-media.ts copy     copy what the target lacks
 *   bun scripts/copy-media.ts verify   read every object from both buckets and compare
 *
 * `verify --public https://media.allthings.dev` also reads each object from the
 * public origin, to prove what visitors get after the cutover. `copy --record
 * <file>` appends each copied object (key, size, MD5, SHA-256) to <file> as a
 * JSON line. `--concurrency <n>` (default 8) bounds requests in flight.
 *
 * It needs no token made by hand, only the logins a maintainer already has
 * (scripts/cloudflare-logins.ts):
 *
 * - The source is read through Cloudflare's REST API with wrangler's login
 *   (`bunx wrangler login`) on the account that holds the bucket now: the
 *   only account it reaches, or SOURCE_ACCOUNT_ID.
 * - The target is written over R2's S3 API with a token the cf CLI's login
 *   on the allthings account (CF_PROFILE, default "allthings") creates for
 *   this run alone: read and write on the target bucket's objects, nothing
 *   else. It lives only in memory and is deleted when the run ends, however
 *   it ends.
 *
 *   bun scripts/copy-media.ts plan
 *
 * SOURCE_BUCKET and TARGET_BUCKET default to allthings-media.
 */
import { appendFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import {
  type Bucket,
  compareOne,
  copyOne,
  differs,
  type Listed,
  type Outcome,
  plan,
  pooled,
  apiBucket,
  publicOrigin,
  s3Bucket,
} from "../src/media-copy.ts";
import { ALLTHINGS_ACCOUNT, MEDIA_BUCKET } from "../src/media.ts";
import {
  createBucketToken,
  wranglerAccount,
  wranglerToken,
} from "./cloudflare-logins.ts";

const listAll = async (bucket: Bucket): Promise<Listed[]> => {
  const objects: Listed[] = [];
  for await (const object of bucket.list()) objects.push(object);
  return objects;
};

const megabytes = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} MB`;

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      record: { type: "string" },
      public: { type: "string" },
      concurrency: { type: "string", default: "8" },
    },
  });
  const command = positionals[0];
  if (command !== "plan" && command !== "copy" && command !== "verify") {
    throw new Error(
      "usage: copy-media.ts plan | copy | verify (see this file's header)",
    );
  }
  const concurrency = Number(values.concurrency);
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error("--concurrency must be a whole number of at least 1");
  }

  const sourceBucket = process.env["SOURCE_BUCKET"] || MEDIA_BUCKET;
  const targetBucket = process.env["TARGET_BUCKET"] || MEDIA_BUCKET;
  const sourceAccount =
    process.env["SOURCE_ACCOUNT_ID"] || (await wranglerAccount());
  if (sourceAccount === ALLTHINGS_ACCOUNT && sourceBucket === targetBucket) {
    throw new Error(
      `source and target are the same bucket: ${sourceBucket} in ${sourceAccount}`,
    );
  }
  let login: Promise<string> | undefined;
  const source = apiBucket({
    accountId: sourceAccount,
    bucket: sourceBucket,
    token: (fresh) => {
      if (fresh || login === undefined) login = wranglerToken();
      return login;
    },
  });
  const token = await createBucketToken({
    accountId: ALLTHINGS_ACCOUNT,
    bucket: targetBucket,
    profile: process.env["CF_PROFILE"] || "allthings",
    name: `allthings media copy ${new Date().toISOString()}`,
  });
  // Interrupted (Ctrl-C), the token is still deleted before the script stops.
  const interrupted = () => {
    void token.revoke().finally(() => process.exit(130));
  };
  process.once("SIGINT", interrupted);
  process.once("SIGTERM", interrupted);
  try {
    const target = s3Bucket({
      accountId: ALLTHINGS_ACCOUNT,
      bucket: targetBucket,
      accessKeyId: token.accessKeyId,
      secretAccessKey: token.secretAccessKey,
    });
    await untilAccepted(target);
    await copy(command, values, concurrency, source, target);
  } finally {
    process.off("SIGINT", interrupted);
    process.off("SIGTERM", interrupted);
    await token.revoke();
    console.log("deleted this run's R2 token");
  }
}

/** A new token takes a few seconds to work everywhere: waits for R2 to accept it. */
async function untilAccepted(target: Bucket): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await target.list()[Symbol.asyncIterator]().next();
      return;
    } catch (error) {
      if (attempt === 10) throw error;
      await Bun.sleep(3_000);
    }
  }
}

async function copy(
  command: "plan" | "copy" | "verify",
  values: { readonly record?: string; readonly public?: string },
  concurrency: number,
  source: Bucket,
  target: Bucket,
): Promise<void> {
  const [sourceObjects, targetObjects] = await Promise.all([
    listAll(source),
    listAll(target),
  ]);
  const { needs, extra } = plan(sourceObjects, targetObjects);
  const count = (need: string) => needs.filter((n) => n.need === need).length;
  const toCopy = needs.filter((n) => n.need === "copy");
  console.log(
    `${source.label}: ${sourceObjects.length} objects, ${megabytes(sourceObjects.reduce((sum, o) => sum + o.size, 0))}`,
  );
  console.log(
    `${target.label}: ${targetObjects.length} objects, ${extra.length} not in the source`,
  );
  console.log(
    `to copy ${toCopy.length} (${megabytes(toCopy.reduce((sum, n) => sum + n.object.size, 0))}), same ${count("same")}, to compare ${count("compare")}, conflicts ${count("conflict")}`,
  );

  const outcomes: Outcome[] = [];
  const report = (outcome: Outcome) => {
    outcomes.push(outcome);
    if (outcome.result === "conflict" || outcome.result === "failed") {
      console.error(`${outcome.result}: ${outcome.key}: ${outcome.reason}`);
    }
  };

  if (command === "plan") {
    for (const { object, need } of needs) {
      if (need === "conflict") console.error(`conflict: ${object.key}`);
    }
    if (count("conflict") > 0) process.exitCode = 1;
    return;
  }

  if (command === "copy") {
    const work = needs.filter((n) => n.need === "copy" || n.need === "compare");
    for await (const outcome of pooled(work, concurrency, ({ object, need }) =>
      (need === "copy"
        ? copyOne(source, target, object)
        : compareOne(source, target, object.key)
      ).catch(
        (error: unknown): Outcome => ({
          key: object.key,
          result: "failed",
          reason: error instanceof Error ? error.message : String(error),
        }),
      ),
    )) {
      report(outcome);
      if (outcome.result === "copied" && values.record !== undefined) {
        await appendFile(values.record, `${JSON.stringify(outcome)}\n`);
      }
      if (outcomes.length % 100 === 0) {
        console.log(`${outcomes.length}/${work.length}`);
      }
    }
    for (const { object, need } of needs) {
      if (need === "conflict")
        report({
          key: object.key,
          result: "conflict",
          reason: "listed with another size or MD5",
        });
    }
  }

  if (command === "verify") {
    const origin =
      values.public === undefined ? undefined : publicOrigin(values.public);
    for await (const outcome of pooled(
      needs,
      concurrency,
      async ({ object }) => {
        try {
          const compared = await compareOne(source, target, object.key);
          if (compared.result !== "same" || origin === undefined)
            return compared;
          // Visitors get the target's bytes; the edge may add its own headers.
          const [served, stored] = await Promise.all([
            origin.get(object.key),
            target.get(object.key),
          ]);
          if (served === undefined || stored === undefined) {
            return {
              key: object.key,
              result: "failed",
              reason: `missing from ${origin.label}`,
            } as const;
          }
          const difference = differs(
            { ...served, headers: {} },
            { ...stored, headers: {} },
          );
          return difference === undefined
            ? compared
            : ({
                key: object.key,
                result: "conflict",
                reason: `${origin.label}: ${difference}`,
              } as const);
        } catch (error) {
          return {
            key: object.key,
            result: "failed",
            reason: error instanceof Error ? error.message : String(error),
          } as const;
        }
      },
    )) {
      report(outcome);
    }
  }

  const tally = (result: Outcome["result"]) =>
    outcomes.filter((o) => o.result === result).length;
  console.log(
    `copied ${tally("copied")}, same ${tally("same")}, conflicts ${tally("conflict")}, failed ${tally("failed")}`,
  );
  if (tally("conflict") + tally("failed") > 0) process.exitCode = 1;
}

await main();
