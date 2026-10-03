import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as RemovalPolicy from "alchemy/RemovalPolicy";
import * as Effect from "effect/Effect";

const PRODUCTION = "prod";
const MEDIA_DOMAIN = "media.allthings.dev";

export default Alchemy.Stack(
  "allthings",
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  Effect.gen(function* () {
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

    // Event covers, speaker photos and host logos. Production serves them on
    // media.allthings.dev; other stages get their own disposable bucket.
    const media = Cloudflare.R2.Bucket("Media", {
      name: production ? "allthings-media" : `allthings-media-${stage}`,
      domains,
      forceDestroy: !production,
    });
    const bucket = yield* production
      ? media.pipe(RemovalPolicy.retain())
      : media;

    return { mediaBucket: bucket.bucketName };
  }),
);
