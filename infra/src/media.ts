import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as RemovalPolicy from "alchemy/RemovalPolicy";
import * as Effect from "effect/Effect";

export const PRODUCTION = "prod";
export const MEDIA_DOMAIN = "media.allthings.dev";

/**
 * Event covers, speaker photos and host logos. Production serves them on
 * media.allthings.dev and keeps the bucket even if this declaration goes away;
 * other stages get their own disposable bucket.
 */
export const Media = Effect.gen(function* () {
  const { stage } = yield* Alchemy.Stack;
  const production = stage === PRODUCTION;

  // The domain's zone must live in the deploying account; resolving it here
  // fails the plan instead of a half-applied deploy.
  const domains = production
    ? [
        {
          name: MEDIA_DOMAIN,
          zone: yield* Cloudflare.Zone.resolveZoneId({
            accountId: (yield* yield* Cloudflare.CloudflareEnvironment)
              .accountId,
            zone: "allthings.dev",
            hostname: MEDIA_DOMAIN,
          }).pipe(Effect.orDie),
          minTLS: "1.2" as const,
        },
      ]
    : [];

  const bucket = Cloudflare.R2.Bucket("Media", {
    // R2 bucket names allow only lowercase letters, digits and hyphens; the
    // default personal stage is live_$USER.
    name: production
      ? "allthings-media"
      : `allthings-media-${stage.toLowerCase().replace(/[^a-z0-9-]+/g, "-")}`,
    domains,
    forceDestroy: !production,
  });
  return yield* production ? bucket.pipe(RemovalPolicy.retain()) : bucket;
});
