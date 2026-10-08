import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import type * as Output from "alchemy/Output";
import * as Effect from "effect/Effect";
import { compatibility } from "../../web/src/compatibility.ts";
import { Collaborator } from "./reader.ts";
import { requiredSecret } from "./sync.ts";
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
 *   policy lets in `PREVIEW_VIEWERS`, signing in with a one-time PIN sent
 *   to their email (`OneTimePin`, Access's own login: no identity
 *   provider to run, and no Cloudflare account needed), the only login it
 *   allows, so the login page goes straight to it. The
 *   Worker enrolls itself in it (`access`), which covers its workers.dev
 *   URL, every domain it may get and its version previews.
 * - **In the Worker.** Access signs each request it lets through; the
 *   Worker checks that token against the team's keys, this application's
 *   audience and the same viewers (web/src/preview/access.ts), and refuses
 *   anything else. It reads the token, not `ctx.access`, because a Worker
 *   with static assets doesn't get `ctx.access`.
 *
 * Access needs the account's Zero Trust organization, the team domain
 * `allthingsdev.cloudflareaccess.com` (`AccessTeam`), which Alchemy adopts
 * when it exists and creates when it doesn't.
 */

/**
 * Whether prod deploys the preview: a reviewed one-line switch, as the
 * sync's are (src/sync.ts). Access must be on for the account first: a
 * stack that declares an Access application where Zero Trust is off fails
 * to plan at all, which would stop every prod deploy. On since the
 * allthings account has its Zero Trust organization (team allthings, Free,
 * turned on in October 2026).
 */
export const PREVIEW: { readonly deploy: boolean } = { deploy: true };

/**
 * Who may see drafts, by the email they sign in with. Andre's is the one
 * he commits with; if he signs in to Access with another, change it here.
 */
export const PREVIEW_VIEWERS = [
  "ethorelli@gmail.com",
  "andre.timo.landgraf@gmail.com",
] as const;

/**
 * The Zero Trust email list of draft collaborators, by its id, which the
 * Access policy also admits (core/README.md, "Collaborating on a draft").
 * infra/scripts/zero-trust-token.sh made the list, and printed this id; it
 * isn't a secret. `previewPolicies()` admits it; `previewPolicies(null)`
 * admits the organizers alone.
 *
 * The stack names the list but never declares it: Alchemy reconciles a
 * list's items as a full set on every deploy, which would empty it. The
 * studio (`bun run collab`, core/src/collab/access.ts) keeps its items equal
 * to the active invitations. The list admits someone at the edge only; the
 * Worker still checks their invitation on every request.
 */
export const COLLABORATOR_LIST_ID: string | undefined =
  "c1bb53e8-ceb1-4adb-b63f-4458faae7d24";

/** The preview's Access policies: the organizers, and the collaborators' list once it exists. */
export const previewPolicies = (
  /** The collaborators list, or null for none: the organizers alone. */
  listId: string | null = COLLABORATOR_LIST_ID ?? null,
) => [
  {
    name: "The organizers",
    decision: "allow" as const,
    include: PREVIEW_VIEWERS.map((email) => ({ email })),
  },
  ...(listId === null
    ? []
    : [
        {
          name: "Invited collaborators",
          decision: "allow" as const,
          include: [{ emailList: { id: listId } }],
        },
      ]),
];

/**
 * The account's Access team, as allthings.dev is named: "allthings" is
 * someone else's (team names are unique across Cloudflare).
 */
export const ACCESS_TEAM_DOMAIN = "allthingsdev.cloudflareaccess.com";

export const AccessTeam = Cloudflare.Access.Organization("AccessTeam", {
  authDomain: ACCESS_TEAM_DOMAIN,
  name: "allthingsdev",
});

/** Access's one-time PIN login: a code sent to the email signing in. */
export const OneTimePin = Cloudflare.Access.IdentityProvider("OneTimePin", {
  type: "onetimepin",
});

/** The preview's Access application, allowing only the one-time PIN login. */
export const makePreviewAccess = Effect.gen(function* () {
  const pin = yield* OneTimePin;
  return yield* Cloudflare.Access.Application("PreviewAccess", {
    type: "self_hosted",
    name: "allthings draft preview",
    sessionDuration: "24h",
    allowedIdps: [pin.identityProviderId],
    autoRedirectToIdentity: true,
    policies: previewPolicies(),
  });
});

/**
 * Production's database as draft_collab, for collaborating on a draft
 * (core/README.md, "Collaborating on a draft"): who is invited, the brief,
 * and what collaborators hand in. It never caches, so a revoked invitation
 * is refused on the very next request, and a collaborator sees what they
 * just handed in. Pages themselves are still read through `Database`, as
 * site_reader.
 */
export const CollabDatabase = Cloudflare.Hyperdrive.Connection("Collab", {
  origin: Collaborator,
  caching: { disabled: true },
  originConnectionLimit: 5,
});

/**
 * The preview Worker, linking every page it doesn't show (the evenings,
 * people, a published evening) to the site at `publicUrl`.
 */
export const makePreview = (publicUrl: Output.Output<string> | string) =>
  Effect.gen(function* () {
    const team = yield* AccessTeam;
    const access = yield* makePreviewAccess;
    return yield* Cloudflare.Worker("Preview", {
      main: "../web/src/preview/worker.ts",
      compatibility,
      assets: "../web/dist/public",
      env: {
        ORIGIN: SITE_ORIGIN,
        PUBLIC_URL: publicUrl,
        HYPERDRIVE: Database,
        COLLAB: CollabDatabase,
        // Signs the collaborators' forms (web/src/preview/forms.ts): made once,
        // kept in Alchemy's state, and known to nothing but this Worker.
        COLLAB_FORM_KEY: Alchemy.makeRandom("CollabFormKey"),
        // Seals and opens the rounds' answer keys (core/src/collab/seal.ts).
        // Not Alchemy's: the studio opens them too, for the night, so it is
        // made into 1Password by scripts/collab-answers-key.ts, and a prod
        // deploy reads it from there.
        COLLAB_ANSWERS_KEY: requiredSecret("COLLAB_ANSWERS_KEY"),
        IMAGES: Cloudflare.Images.Images("IMAGES"),
        ACCESS_TEAM_DOMAIN: team.authDomain,
        ACCESS_AUD: access.aud,
        PREVIEW_VIEWERS: PREVIEW_VIEWERS.join(","),
      },
      access,
      // Its own workers.dev URL, where the organizers open it; Access
      // covers it and the version previews alike.
      workersDev: true,
    });
  });
