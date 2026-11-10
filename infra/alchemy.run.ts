import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Output from "alchemy/Output";
import * as Effect from "effect/Effect";
import { makeAlerts, withAlertProviders } from "./src/alerts.ts";
import {
  MEDIA_BUCKET,
  MEDIA_ZONE,
  Media,
  isProduction,
  mediaZone,
  productionRole,
  siteServing,
} from "./src/media.ts";
import { PREVIEW, makePreview } from "./src/preview.ts";
import { REQUESTS_DATASET } from "../web/src/metrics.ts";
import { makeSync, syncPlan } from "./src/sync.ts";
import { MediaUpload, MediaUploadCheck } from "./src/upload-worker.ts";
import {
  VariantsCheck,
  Web,
  makeWeb,
  siteDomain,
  siteRefreshToken,
  webAnalytics,
} from "./src/web.ts";

export default Alchemy.Stack(
  "allthings",
  {
    // Alchemy's Cloudflare providers, and the alerts' own (src/alerts.ts).
    providers: withAlertProviders(Cloudflare.providers()),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    // Every stage but prod (PR previews, staging, personal stages) runs only
    // the Web Worker, reading production through its own Hyperdrive, in the
    // allthings account.
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

    // The new site, in the allthings account only: on workers.dev until
    // allthings.dev is active there, then on allthings.dev (www redirects).
    const serving = siteServing(accountId, zone);
    // Web Analytics measures allthings.dev alone, once it serves here.
    const analytics =
      serving === "allthings.dev" && zone !== undefined
        ? yield* webAnalytics(zone.id)
        : undefined;
    const site =
      serving === "none"
        ? undefined
        : yield* makeWeb(
            serving === "allthings.dev" && zone !== undefined
              ? siteDomain(zone.id)
              : undefined,
            siteRefreshToken,
            REQUESTS_DATASET.prod,
            analytics?.siteToken.as<string>(),
          );
    const webUrl = site?.url.as<string>();
    // Every deploy proves the variants bucket takes writes (src/web.ts).
    if (site !== undefined) {
      yield* VariantsCheck({
        url: site.url.as<string>(),
        token: yield* siteRefreshToken,
        workerHash: site.hash.pipe(
          Output.map((hash) => hash?.bundle ?? "unbuilt"),
        ),
        // New on every deploy, so the check runs on every one.
        run: crypto.randomUUID(),
      });
    }
    // The draft preview, behind Access, beside the site (src/preview.ts).
    const preview =
      site === undefined || !PREVIEW.deploy
        ? undefined
        : yield* makePreview(site.url.as<string>());
    const previewUrl = preview?.url.as<string>();

    // The hourly Luma sync (src/sync.ts), in the allthings account only,
    // whether allthings.dev is pending or active there: it needs no domain.
    // Its script name is an output, for reading its logs (README, "The Luma
    // sync").
    const syncing = syncPlan(accountId, zone);
    const sync =
      syncing === undefined ? undefined : yield* makeSync(syncing.images, site);
    const syncWorker = sync?.workerName.as<string>();

    // Email when the site's Worker fails, a sync fails, or none has
    // succeeded for two hours (src/alerts.ts), in the allthings account.
    yield* makeAlerts(
      site?.workerName.as<string>(),
      sync?.workerName.as<string>(),
    );

    if (role === "stage") {
      return {
        webUrl,
        previewUrl,
        syncWorker,
        mediaBucket: MEDIA_BUCKET,
        mediaDomain: `not attached until ${MEDIA_ZONE} is active in this account`,
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

    return {
      webUrl,
      previewUrl,
      mediaBucket: MEDIA_BUCKET,
      mediaUploadUrl: upload.url.as<string>(),
      syncWorker,
    };
  }),
);
