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
 * Credentials come from the environment only, as R2 API tokens' S3 access
 * keys: read-only for the source, object write for the target, each limited
 * to its bucket. Pass them without printing them, e.g.
 *
 *   SOURCE_ACCOUNT_ID=… TARGET_ACCOUNT_ID=af627f300cd00c4dca56aacf05bea050 \
 *   SOURCE_ACCESS_KEY_ID=$(op read "op://Private/allthings media source/username") \
 *   SOURCE_SECRET_ACCESS_KEY=$(op read "op://Private/allthings media source/credential") \
 *   TARGET_ACCESS_KEY_ID=$(op read "op://Private/allthings media target/username") \
 *   TARGET_SECRET_ACCESS_KEY=$(op read "op://Private/allthings media target/credential") \
 *     bun scripts/copy-media.ts plan
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
  publicOrigin,
  s3Bucket,
} from "../src/media-copy.ts";
import { MEDIA_BUCKET } from "../src/media.ts";

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required (see this file's header)`);
  return value;
};

const bucketFromEnv = (side: "SOURCE" | "TARGET") =>
  s3Bucket({
    accountId: required(`${side}_ACCOUNT_ID`),
    bucket: process.env[`${side}_BUCKET`] || MEDIA_BUCKET,
    accessKeyId: required(`${side}_ACCESS_KEY_ID`),
    secretAccessKey: required(`${side}_SECRET_ACCESS_KEY`),
  });

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

  const source = bucketFromEnv("SOURCE");
  const target = bucketFromEnv("TARGET");
  if (source.label === target.label) {
    throw new Error(`source and target are the same bucket: ${source.label}`);
  }

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
