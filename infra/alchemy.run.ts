import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Output from "alchemy/Output";
import * as Effect from "effect/Effect";
import {
  MEDIA_BUCKET,
  MEDIA_DOMAIN,
  MEDIA_ZONE,
  Media,
  isProduction,
  mediaZone,
  productionRole,
} from "./src/media.ts";
import { Sync } from "./src/sync.ts";
import { MediaUpload, MediaUploadCheck } from "./src/upload-worker.ts";
import { VercelEnv } from "./src/vercel-env.ts";
import { Web } from "./src/web.ts";

export default Alchemy.Stack(
  "allthings",
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  Effect.gen(function* () {
    // Every stage but prod (PR previews, staging, personal stages) runs only
    // the Worker replacing the app, reading production through its own
    // Hyperdrive, in the allthings account. Prod keeps the media the app on
    // Vercel uses until the Worker serves the site.
    if (!(yield* isProduction)) {
      const web = yield* Web;
      return { webUrl: web.url.as<string>() };
    }

    // Prod follows allthings.dev between accounts (see productionRole): where
    // the zone is active it serves; in the allthings account before then it
    // only holds the bucket the media is copied into.
    const { accountId, zone } = yield* mediaZone;
    const role = productionRole(accountId, zone);
    if (role instanceof Error) return yield* Effect.die(role);
    yield* Media;
    if (role === "stage") {
      return {
        mediaBucket: MEDIA_BUCKET,
        mediaDomain:
          zone === undefined
            ? `not attached until ${MEDIA_ZONE} is added to this account`
            : `attached; serves once ${MEDIA_ZONE} is active here`,
      };
    }

    const upload = yield* MediaUpload;
    const token = yield* Alchemy.makeRandom("MediaUploadToken");
    yield* MediaUploadCheck({
      url: upload.url.as<string>(),
      token,
      workerHash: upload.hash.pipe(
        Output.map((hash) => hash?.bundle ?? "unbuilt"),
      ),
    });

    // The hourly Luma sync, its schedule off until the cutover (src/sync.ts).
    yield* Sync;

    // The app on Vercel uploads through the Worker and links to the domain.
    // Development gets the token too, so admin scripts can upload from a
    // maintainer's machine after `vercel env pull`.
    const everywhere = ["production", "preview", "development"] as const;
    yield* VercelEnv("MEDIA_UPLOAD_URL", upload.url.as<string>(), {
      sensitive: false,
      targets: everywhere,
    });
    yield* VercelEnv("MEDIA_UPLOAD_TOKEN", token, {
      sensitive: true,
      targets: everywhere,
    });
    yield* VercelEnv("MEDIA_PUBLIC_URL", `https://${MEDIA_DOMAIN}`, {
      sensitive: false,
      targets: everywhere,
    });

    return {
      mediaBucket: MEDIA_BUCKET,
      mediaUploadUrl: upload.url.as<string>(),
    };
  }),
);
