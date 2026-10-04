import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Output from "alchemy/Output";
import * as Effect from "effect/Effect";
import { Media, PRODUCTION, MEDIA_DOMAIN } from "./src/media.ts";
import { MediaUpload, MediaUploadCheck } from "./src/upload-worker.ts";
import { Web } from "./src/web.ts";
import { VercelEnv } from "./src/vercel-env.ts";

export default Alchemy.Stack(
  "allthings",
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  Effect.gen(function* () {
    const media = yield* Media;
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
    const { stage } = yield* Alchemy.Stack;
    if (stage === PRODUCTION) {
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
    }

    // The Worker replacing the app runs on every stage but prod until its
    // data bindings land, so a prod deploy changes nothing yet.
    const web = stage === PRODUCTION ? undefined : yield* Web;

    return {
      mediaBucket: media.bucketName,
      mediaUploadUrl: upload.url.as<string>(),
      ...(web === undefined ? {} : { webUrl: web.url.as<string>() }),
    };
  }),
);
