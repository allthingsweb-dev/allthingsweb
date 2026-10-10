import { PgClient } from "@effect/sql-pg";
import * as Database from "allthings-core/src/database.ts";
import { About } from "allthings-core/src/about.ts";
import { Community } from "allthings-core/src/community.ts";
import { DataSourceError } from "allthings-core/src/errors.ts";
import { Evenings } from "allthings-core/src/evenings.ts";
import { ExternalTalks } from "allthings-core/src/external-talks.ts";
import { EventPages } from "allthings-core/src/event-page.ts";
import { Events } from "allthings-core/src/events.ts";
import { Home } from "allthings-core/src/home.ts";
import { PeopleDirectory } from "allthings-core/src/people-directory.ts";
import { Portraits } from "allthings-core/src/portraits.ts";
import { Redirects } from "allthings-core/src/redirects.ts";
import { Speakers } from "allthings-core/src/speakers.ts";
import { Context, Effect, Layer, Option, Redacted } from "effect";
import { FeedData } from "./seo/data.ts";
import { V1Data } from "./v1/data.ts";

/** Every repository a request may read from. */
export type Repositories =
  | About
  | Community
  | Evenings
  | EventPages
  | Events
  | ExternalTalks
  | FeedData
  | Home
  | PeopleDirectory
  | Portraits
  | Redirects
  | Speakers
  | V1Data;

/** What the Worker reads from a Hyperdrive binding. */
export interface HyperdriveBinding {
  readonly connectionString: string;
}

// workerd's binding exposes its fields as getters on its prototype, so the
// field is read, not looked up as an own property.
const isHyperdriveBinding = (value: unknown): value is HyperdriveBinding =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { connectionString?: unknown }).connectionString ===
    "string";

/**
 * The Worker's `HYPERDRIVE` binding, if it has one. Bindings are fixed for an
 * isolate, so it is looked up once; its connection string is read for each
 * request. Without it (tests that bind `DATABASE_URL`, or nothing), requests
 * connect to `DATABASE_URL`.
 */
export class Hyperdrive extends Context.Reference<
  Option.Option<HyperdriveBinding>
>("allthings/web/Hyperdrive", { defaultValue: () => Option.none() }) {
  static readonly layer = (env: Readonly<Record<string, unknown>>) =>
    Layer.succeed(
      Hyperdrive,
      Option.liftPredicate(env["HYPERDRIVE"], isHyperdriveBinding),
    );
}

/**
 * A pool on Hyperdrive's connection string, with TLS off. The Worker's leg
 * runs inside Cloudflare to Hyperdrive, which makes the TLS connection to
 * Neon, so a deployed binding's string says `sslmode=disable`. Alchemy's
 * local runtime instead hands the Worker its origin directly, with the
 * `sslmode` Hyperdrive would use towards that origin (`require` unless the
 * origin says otherwise). `@effect/sql-pg` applies a URL's `sslmode` to its
 * own socket, so that string would demand TLS of a local server that may
 * not offer it. An explicit `ssl` wins over the URL's, which makes the
 * Worker's leg plain in both.
 */
const hyperdrivePool = (binding: HyperdriveBinding) =>
  PgClient.layer({
    url: Redacted.make(binding.connectionString),
    ssl: false,
  });

/**
 * The repositories over one Postgres pool: on Hyperdrive when the Worker has
 * the binding, otherwise at `DATABASE_URL`. Provide it to each request that
 * reads data, never to the isolate: workerd ties a socket to the request that
 * opened it, so a pool cannot outlive one. Pooling across requests is
 * Hyperdrive's job. The pool connects on its first query and closes, without
 * waiting, when the request's program ends.
 *
 * Neither a binding nor `DATABASE_URL` fails like an unreachable database
 * would: as a `DataSourceError`, which clients see as "temporarily
 * unavailable".
 */
/** The request's pool: on Hyperdrive when the Worker has the binding, otherwise at `DATABASE_URL`. */
export const pool = Layer.unwrap(
  Effect.gen(function* () {
    return Option.match(yield* Hyperdrive, {
      onNone: () => Database.layer,
      onSome: hyperdrivePool,
    });
  }),
);

export const repositories: Layer.Layer<Repositories, DataSourceError> =
  Layer.effectContext(
    Layer.build(
      Layer.mergeAll(
        About.layer,
        Community.layer,
        Evenings.layer,
        EventPages.layer,
        Events.layer,
        ExternalTalks.layer,
        FeedData.layer,
        Home.layer,
        PeopleDirectory.layer,
        Portraits.layer,
        Redirects.layer,
        Speakers.layer,
        V1Data.layer,
      ).pipe(Layer.provide(pool)),
    ).pipe(Effect.mapError((cause) => new DataSourceError({ cause }))),
  );
