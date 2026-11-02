import { PgClient } from "@effect/sql-pg";
import { Config, Layer } from "effect";
import type { ConfigError } from "effect/Config";
import type { SqlClient } from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";
import * as SiteRefresh from "./site-refresh.ts";

/**
 * Postgres (Neon) for the repositories, at the `DATABASE_URL` connection
 * string. The URL is read as a redacted secret, so it never appears in logs or
 * error messages.
 *
 * `@effect/sql-pg` speaks the wire protocol itself over `node:net` and
 * `node:tls`, both available in Workers with `nodejs_compat`. A Worker reaches
 * Neon through Hyperdrive's connection string and must build this layer once
 * per request: Workers cannot share a socket between requests, and Hyperdrive
 * already pools the connections behind it.
 */
export const layer: Layer.Layer<
  PgClient.PgClient | SqlClient,
  ConfigError | SqlError
> = PgClient.layerConfig({ url: Config.Redacted("DATABASE_URL") });

/**
 * {@link layer} for a command (core/scripts/), which tells allthings.dev
 * when it ends that its data may have changed (site-refresh.ts), so the
 * change shows within minutes rather than the hour. Every script connects
 * through it (tests/site-refresh.test.ts holds them to it); the Worker
 * and tests use {@link layer}.
 */
export const scriptLayer: Layer.Layer<
  PgClient.PgClient | SqlClient,
  ConfigError | SqlError
> = Layer.merge(layer, SiteRefresh.afterwards);
