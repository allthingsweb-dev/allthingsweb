import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Output from "alchemy/Output";
import * as Effect from "effect/Effect";
import { MEDIA_DOMAIN, Media, isProduction } from "./src/media.ts";
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

    yield* Media;
    const upload = yield* MediaUpload;
    const token = yield* Alchemy.makeRandom("MediaUploadToken");
    yield* MediaUploadCheck({
      url: upload.url.as<string>(),
      token,
      workerHash: upload.hash.pipe(
        Output.map((hash) => hash?.bundle ?? "unbuilt"),
      ),
    });

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
      mediaBucket: "allthings-media",
      mediaUploadUrl: upload.url.as<string>(),
    };
  }),
);
