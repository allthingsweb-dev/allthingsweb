import * as Database from "allthings-core/src/database.ts";
import { DataSourceError } from "allthings-core/src/errors.ts";
import { Events } from "allthings-core/src/events.ts";
import { Home } from "allthings-core/src/home.ts";
import { Speakers } from "allthings-core/src/speakers.ts";
import { Effect, Layer } from "effect";
import { V1Data } from "./v1/data.ts";

/** Every repository a request may read from. */
export type Repositories = Events | Home | Speakers | V1Data;

/**
 * The repositories over one Postgres pool, at `DATABASE_URL`. Provide it to
 * each request that reads data, never to the isolate: workerd ties a socket to
 * the request that opened it, so a pool cannot outlive one. Pooling across
 * requests is Hyperdrive's job. The pool connects on its first query and
 * closes, without waiting, when the request's program ends.
 *
 * A missing `DATABASE_URL` fails like an unreachable database would: as a
 * `DataSourceError`, which clients see as "temporarily unavailable".
 */
export const repositories: Layer.Layer<Repositories, DataSourceError> =
  Layer.effectContext(
    Layer.build(
      Layer.mergeAll(
        Events.layer,
        Home.layer,
        Speakers.layer,
        V1Data.layer,
      ).pipe(Layer.provide(Database.layer)),
    ).pipe(Effect.mapError((cause) => new DataSourceError({ cause }))),
  );
