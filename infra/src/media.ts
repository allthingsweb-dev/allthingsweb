import * as zones from "@distilled.cloud/cloudflare/zones";
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as RemovalPolicy from "alchemy/RemovalPolicy";
import * as Effect from "effect/Effect";

export const PRODUCTION = "prod";
export const MEDIA_DOMAIN = "media.allthings.dev";
export const MEDIA_BUCKET = "allthings-media";
export const MEDIA_ZONE = "allthings.dev";

/** The Cloudflare account that holds everything allthings once the domain moves in. */
export const ALLTHINGS_ACCOUNT = "af627f300cd00c4dca56aacf05bea050";

/** allthings.dev as a zone of the deploying account, if it is one. */
export interface MediaZone {
  readonly id: string;
  /** Pending while the domain is on its way in; active once it serves. */
  readonly active: boolean;
}

/**
 * What prod is in the deploying account:
 *
 * - `serve`: allthings.dev is active here, so its bucket answers on
 *   media.allthings.dev and the upload Worker and Vercel's settings follow it.
 * - `stage`: the allthings account while the domain hasn't moved in. Only the
 *   bucket, for scripts/copy-media.ts to fill. media.allthings.dev isn't
 *   attached yet: R2 refuses a custom domain on a pending zone ("The
 *   specified zone id is not valid"), so the first deploy after the zone
 *   turns active attaches it (see {@link mediaDomains}).
 *
 * Anywhere else prod is refused: an account the domain has left would
 * otherwise drop the upload Worker and the Vercel settings the app relies on.
 */
export type ProductionRole = "serve" | "stage";

export const productionRole = (
  accountId: string,
  zone: MediaZone | undefined,
): ProductionRole | Error =>
  zone?.active === true
    ? "serve"
    : accountId === ALLTHINGS_ACCOUNT
      ? "stage"
      : new Error(
          `prod deploys from the account where ${MEDIA_ZONE} is active, or the allthings account (${ALLTHINGS_ACCOUNT}) while the domain moves in; ${MEDIA_ZONE} is not active in ${accountId}`,
        );

const deployingAccount = Effect.gen(function* () {
  return (yield* yield* Cloudflare.CloudflareEnvironment).accountId;
});

/** allthings.dev in the deploying account, read when the stack is planned. */
export const mediaZone = Effect.gen(function* () {
  const accountId = yield* deployingAccount;
  const page = yield* zones
    .listZones({ account: { id: accountId }, name: MEDIA_ZONE, perPage: 1 })
    .pipe(Effect.orDie);
  const zone = (page.result ?? []).find(
    (candidate) =>
      candidate.name === MEDIA_ZONE && candidate.account.id === accountId,
  );
  const found: MediaZone | undefined =
    zone === undefined
      ? undefined
      : { id: zone.id, active: zone.status === "active" };
  return { accountId, zone: found };
});

/**
 * The bucket's custom domains: media.allthings.dev once allthings.dev is
 * active in this account, and none before. R2 only attaches a custom domain
 * to an active zone; on a pending one it answers "The specified zone id is
 * not valid", which would fail the whole deploy.
 */
export const mediaDomains = (zone: MediaZone | undefined) =>
  zone?.active === true
    ? [{ name: MEDIA_DOMAIN, zone: zone.id, minTLS: "1.2" as const }]
    : [];

/**
 * Event covers, speaker photos and host logos, served on media.allthings.dev
 * when allthings.dev is active in this account. Production only: the bucket
 * is kept even if this declaration goes away.
 */
export const Media = Effect.gen(function* () {
  const { zone } = yield* mediaZone;
  return yield* Cloudflare.R2.Bucket("Media", {
    name: MEDIA_BUCKET,
    domains: mediaDomains(zone),
    forceDestroy: false,
  }).pipe(RemovalPolicy.retain());
});

/** Whether the stack is deploying production. */
export const isProduction = Effect.map(
  Alchemy.Stack,
  ({ stage }) => stage === PRODUCTION,
);

/**
 * Whether prod runs the new site in the deploying account, and on what:
 * only in the allthings account, on its workers.dev URL until allthings.dev
 * is active there, then on allthings.dev itself. Any other account (the one
 * the domain is leaving) never runs it: its zone still answers allthings.dev
 * with esthor/domains' redirect until the move.
 */
export type SiteServing = "none" | "workers.dev" | "allthings.dev";

export const siteServing = (
  accountId: string,
  zone: MediaZone | undefined,
): SiteServing =>
  accountId !== ALLTHINGS_ACCOUNT
    ? "none"
    : zone?.active === true
      ? "allthings.dev"
      : "workers.dev";
