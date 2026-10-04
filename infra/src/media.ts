import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as RemovalPolicy from "alchemy/RemovalPolicy";
import * as Effect from "effect/Effect";

export const PRODUCTION = "prod";
export const MEDIA_DOMAIN = "media.allthings.dev";

/**
 * Event covers, speaker photos and host logos, served on media.allthings.dev.
 * Production only: the bucket is kept even if this declaration goes away.
 */
export const Media = Effect.gen(function* () {
  // The domain's zone must live in the deploying account; resolving it here
  // fails the plan instead of a half-applied deploy.
  const zone = yield* Cloudflare.Zone.resolveZoneId({
    accountId: (yield* yield* Cloudflare.CloudflareEnvironment).accountId,
    zone: "allthings.dev",
    hostname: MEDIA_DOMAIN,
  }).pipe(Effect.orDie);

  return yield* Cloudflare.R2.Bucket("Media", {
    name: "allthings-media",
    domains: [{ name: MEDIA_DOMAIN, zone, minTLS: "1.2" as const }],
    forceDestroy: false,
  }).pipe(RemovalPolicy.retain());
});

/** Whether the stack is deploying production. */
export const isProduction = Effect.map(
  Alchemy.Stack,
  ({ stage }) => stage === PRODUCTION,
);
