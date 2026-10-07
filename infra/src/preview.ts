import * as Cloudflare from "alchemy/Cloudflare";
import type * as Output from "alchemy/Output";
import * as Effect from "effect/Effect";
import { compatibility } from "../../web/src/compatibility.ts";
import { Database, SITE_ORIGIN } from "./web.ts";

/**
 * The draft preview: each draft evening's real page, for the organizers
 * alone (web/src/preview/). Prod only, in the allthings account, beside the
 * site it previews.
 *
 * It is its own Worker, so the public one never renders a draft, behind
 * Cloudflare Access twice over:
 *
 * - **At the edge.** `PreviewAccess` is an Access application whose one
 *   policy lets in `PREVIEW_VIEWERS`, signing in with a one-time code to
 *   their email (Access's own login, no identity provider to run). The
 *   Worker enrolls itself in it (`access`), which covers its workers.dev
 *   URL, every domain it may get and its version previews.
 * - **In the Worker.** Access signs each request it lets through; the
 *   Worker checks that token against the team's keys, this application's
 *   audience and the same viewers (web/src/preview/access.ts), and refuses
 *   anything else. It reads the token, not `ctx.access`, because a Worker
 *   with static assets doesn't get `ctx.access`.
 *
 * Access needs the account's Zero Trust organization, the team domain
 * `allthings.cloudflareaccess.com` (`AccessTeam`), which Alchemy adopts
 * when it exists and creates when it doesn't.
 */

/**
 * Whether prod deploys the preview: a reviewed one-line switch, as the
 * sync's are (src/sync.ts). Access must be on for the account first: a
 * stack that declares an Access application where Zero Trust is off fails
 * to plan at all, which would stop every prod deploy. Off until the
 * allthings account has its Zero Trust organization; then on, in a pull
 * request of its own.
 */
export const PREVIEW: { readonly deploy: boolean } = { deploy: false };

/**
 * Who may see drafts, by the email they sign in with. Andre's is the one
 * he commits with; if he signs in to Access with another, change it here.
 */
export const PREVIEW_VIEWERS = [
  "ethorelli@gmail.com",
  "andre.timo.landgraf@gmail.com",
] as const;

/** The account's Access team: allthings.cloudflareaccess.com. */
export const ACCESS_TEAM_DOMAIN = "allthings.cloudflareaccess.com";

export const AccessTeam = Cloudflare.Access.Organization("AccessTeam", {
  authDomain: ACCESS_TEAM_DOMAIN,
  name: "allthings",
});

export const PreviewAccess = Cloudflare.Access.Application("PreviewAccess", {
  type: "self_hosted",
  name: "allthings draft preview",
  sessionDuration: "24h",
  policies: [
    {
      name: "The organizers",
      decision: "allow",
      include: PREVIEW_VIEWERS.map((email) => ({ email })),
    },
  ],
});

/**
 * The preview Worker, linking every page it doesn't show (the evenings,
 * people, a published evening) to the site at `publicUrl`.
 */
export const makePreview = (publicUrl: Output.Output<string> | string) =>
  Effect.gen(function* () {
    const team = yield* AccessTeam;
    const access = yield* PreviewAccess;
    return yield* Cloudflare.Worker("Preview", {
      main: "../web/src/preview/worker.ts",
      compatibility,
      assets: "../web/dist/public",
      env: {
        ORIGIN: SITE_ORIGIN,
        PUBLIC_URL: publicUrl,
        HYPERDRIVE: Database,
        IMAGES: Cloudflare.Images.Images("IMAGES"),
        ACCESS_TEAM_DOMAIN: team.authDomain,
        ACCESS_AUD: access.aud,
        PREVIEW_VIEWERS: PREVIEW_VIEWERS.join(","),
      },
      access,
    });
  });
