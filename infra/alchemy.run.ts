import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as RemovalPolicy from "alchemy/RemovalPolicy";
import * as Effect from "effect/Effect";

const PRODUCTION = "prod";

export default Alchemy.Stack(
  "allthings",
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  Effect.gen(function* () {
    const { stage } = yield* Alchemy.Stack;
    const production = stage === PRODUCTION;

    // Event covers, speaker photos and host logos. Production serves them on
    // media.allthings.dev; other stages get their own disposable bucket.
    const media = Cloudflare.R2.Bucket("Media", {
      name: production ? "allthings-media" : `allthings-media-${stage}`,
      domains: production
        ? [{ name: "media.allthings.dev", minTLS: "1.2" }]
        : [],
      forceDestroy: !production,
    });
    const bucket = yield* production
      ? media.pipe(RemovalPolicy.retain())
      : media;

    return { mediaBucket: bucket.bucketName };
  }),
);
