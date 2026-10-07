# infra

Cloudflare resources for allthings, declared with [Alchemy](https://alchemy.run) v2 in [`alchemy.run.ts`](alchemy.run.ts). Deploy state lives in Cloudflare (`Cloudflare.state()`), so every machine and CI see the same resources.

From `infra/`, sign in to Cloudflare once per machine (browser OAuth), then plan and deploy:

```sh
bun alchemy profile edit --add Cloudflare
bun run plan --stage prod     # preview changes to production
bun run deploy --stage prod   # apply them
bun run deploy --profile allthings   # your own stage (live_$USER): the Web Worker and its Hyperdrive
```

- **Media:** `prod` only. An R2 bucket served on `media.allthings.dev`, kept even if removed from the stack. Its objects never change under a key and are never overwritten when copied (see [Moving media](#moving-media)).
- **Upload Worker:** `prod` only. Stores and deletes media for the app while it runs on Vercel. The bucket is a binding and callers present a token Alchemy generates. It never replaces an object (409 for a key that exists): the site caches variants of each photo for a year under URLs derived from its key, so a replacement goes under a new key. Every deploy proves uploads work by storing and deleting one object.
- **Web Worker:** `web/` (the public API, the MCP server, the home page and `/brand`), on every stage; previews run nothing else. In `prod` it runs only in the allthings account: on its `workers.dev` URL until allthings.dev is active there, then on `allthings.dev`, with `www.allthings.dev` redirected (301, path and query kept) to it. Its `ORIGIN` is `https://allthings.dev` on every stage, so canonical URLs, the sitemap, feeds, calendar files, structured data and link previews always name allthings.dev, and robots.txt admits crawlers only on that host. Alchemy bundles it with web's dependencies and uploads `web/dist/public` as its static assets, so run `bun install` at the repository root and `bun run build` in `web/` before planning or deploying.
- **Draft preview:** `prod` only, in the allthings account, while `PREVIEW.deploy` is on ([`src/preview.ts`](src/preview.ts)). Its own Worker ([`web/src/preview/`](../web/src/preview/app.ts)) renders each draft evening's real page for the organizers, so the Web Worker never reads a draft. Cloudflare Access sits in front of it: an application whose one policy admits `PREVIEW_VIEWERS`, signing in with a one-time PIN sent to their email (the only login it allows), which the Worker enrolls in. The Worker also checks the token Access signs (team keys, this application's audience, the same viewers) and refuses anything else, and every answer is `no-store` and `noindex`. Access needs the account's Zero Trust organization (`allthingsdev.cloudflareaccess.com`; `allthings` is taken). A stack that declares an Access application where Zero Trust is off fails to plan, so `PREVIEW.deploy` is the switch: on, now that the account has it.
- **Images:** the Web Worker's `IMAGES` binding, wherever it runs. It resizes and re-encodes the photos on `media.allthings.dev` into the variants the pages load (`/img/…`, see [`web/src/images/variants.ts`](../web/src/images/variants.ts)), and the Worker keeps each in the edge cache. It is a binding, not a resource: transformations are billed to the allthings account per unique transformation per month, the first 5,000 free. Past those, new variants fail and the Worker sends the originals instead.
- **Hyperdrive:** wherever the Web Worker runs. Its `HYPERDRIVE` binding, in front of production's Neon database as the read-only `site_reader` role, from `NEON_READER_URL` (see [Accounts and stages](#accounts-and-stages)).
- **Vercel env:** `prod` deploys write `MEDIA_UPLOAD_URL`, `MEDIA_UPLOAD_TOKEN` and `MEDIA_PUBLIC_URL` to every Vercel environment (the token is sensitive except in development, where Vercel doesn't allow it) with the Vercel CLI, so it needs to be signed in (`bunx vercel login`).
- **Sync Worker:** `prod` only. The hourly Luma sync ([`web/src/sync/`](../web/src/sync/worker.ts)), off Vercel's cron and outside the site's Worker. It has its own bindings:
  - a `Writer` Hyperdrive in front of production as `site_sync`, from `NEON_SYNC_URL`, which never caches
  - the media bucket and the Images binding
  - `LUMA_API_KEY` as a secret: hidden venues, drafts, descriptions and cover lookups
  - `X_BEARER_TOKEN` as a secret: follower counts and the post finder's X search, billed per post it reads

  It ships off, and runs nothing without every one of them: see [The Luma sync](#the-luma-sync).

## Accounts and stages

allthings has its own Cloudflare account (`af627f300cd00c4dca56aacf05bea050`), so a deploy credential can only touch allthings resources. Every stage but `prod` deploys there and runs only the Web Worker, reading production's data through a Hyperdrive of its own:

- **`pr-<number>`:** one per pull request, deployed by [`deploy.yaml`](../.github/workflows/deploy.yaml) on every push and destroyed, Hyperdrive included, when the PR closes. Its URL is in the PR's deployment and the run summary.
- **`staging`:** main, deployed on every merge.
- **Your own stage:** `bun run deploy --profile allthings` from a machine signed in with `bun alchemy profile edit --profile allthings --add Cloudflare`, with `NEON_READER_URL` in the environment (below).

Each stage's Hyperdrive connects to production's Neon branch as `site_reader`, which may only `SELECT` the tables the public site reads and starts every transaction read-only, so nothing outside prod can write production's data or read anything else. The stack refuses a `NEON_READER_URL` for any other role, including Neon's own `reader`, which belongs to `neon_superuser` and can write. [`scripts/site-reader.ts`](scripts/site-reader.ts) creates the role or rotates its password, and stores the connection string in the repository secret and 1Password. Previews only read, so Hyperdrive caches query results for 60 seconds and may serve them up to 15 seconds stale while it refreshes them; each stage holds at most about 5 connections to Neon. CI deploys with the `NEON_READER_URL` repository secret, a direct (not pooled) connection string. On your machine, pass the same string without printing it:

```sh
NEON_READER_URL=$(op read "op://Private/allthings site_reader/credential") \
  bun run deploy --profile allthings
```

`alchemy destroy` needs no `NEON_READER_URL`.

The hourly Luma sync writes production as `site_sync`, a second login role made the same way by [`scripts/site-sync.ts`](scripts/site-sync.ts):

- It holds only the column privileges the sync's statements use: upserting events from Luma's feed, and storing missing covers, profile photos and post images.
- It has no `DELETE`, and no access to any table the sync doesn't touch.
- Its statements, lock waits and idle transactions time out at 30 seconds or less.

[`core/tests/site-sync.test.ts`](../core/tests/site-sync.test.ts) runs the sync as the role and checks everything else is refused. The connection string is in the `NEON_SYNC_URL` repository secret and the "allthings site_sync" 1Password item.

`prod` (media, the upload and sync Workers, and the Vercel env) follows the allthings.dev zone. Where the zone is active, prod serves: the bucket answers on `media.allthings.dev`, and the Workers and the Vercel env follow it. That is the `default` profile's account until the domain moves. In the allthings account before then, `bun run deploy --stage prod --profile allthings` stages the bucket (without `media.allthings.dev`: R2 refuses a custom domain on a pending zone) and runs the Web Worker on its `workers.dev` URL against production's data (it needs `NEON_READER_URL`). Once the zone is active there, the same deploy attaches `media.allthings.dev` to the bucket and `allthings.dev` and `www.allthings.dev` to the Web Worker. The `default` account never runs the Web Worker: until the move its zone answers allthings.dev with [esthor/domains](https://github.com/esthor/domains)' redirect. Any other account is refused, so a deploy from an account the domain has left can't drop the upload Worker or the Vercel env.

## Moving media

The move of allthings.dev into the allthings account is itself the cutover: an R2 custom domain only serves from the zone's own account. [`docs/r2-migration.md`](docs/r2-migration.md) is the runbook, from enabling R2 to retiring the old bucket.

[`scripts/copy-media.ts`](scripts/copy-media.ts) copies the bucket between accounts, so the allthings account's bucket holds every object before `media.allthings.dev` switches to it. It never overwrites or deletes: the source keeps every original, and a rerun copies only what the target still lacks.

Each copy is checked three times:

- The bytes read must hash to the source's ETag.
- R2 refuses the upload unless the bytes match the Content-MD5 sent with them.
- The ETag R2 stores must be that MD5.

`verify` reads every object from both buckets, and optionally from the public origin, and compares SHA-256s and headers.

It needs no token made by hand ([`scripts/cloudflare-logins.ts`](scripts/cloudflare-logins.ts)):

- It reads the source through Cloudflare's REST API with wrangler's login on the account that holds it now.
- It writes the target over R2's S3 API with a token that the cf CLI's `allthings` login creates for the run alone, limited to the bucket's objects. The token is kept in memory and deleted when the run ends.

The file's header has the commands.

## The Luma sync

The Sync Worker runs what the app's cron runs every hour. It syncs `events` from Luma's calendar first, then fills in the venues the calendar hides (shown to guests only) from Luma's API and gives new evenings their short links. Then it stores the images still missing: profile photos, post images, event covers. Last, in a window of its own, it imports their descriptions from Luma's API. Every step writes only what is missing or changed, so a run cut short leaves nothing half done, and the next run carries on. It answers no requests.

Three reviewed constants in [`src/sync.ts`](src/sync.ts) decide what it does, so each change is a one-line pull request:

| `SYNC.`    | Now                                                   | Then                                                                |
| ---------- | ----------------------------------------------------- | ------------------------------------------------------------------- |
| `schedule` | `"off"`: no Cron Trigger at all                       | `"hourly"`: `0 * * * *`, once the app's cron stops at the cutover   |
| `mode`     | `"dry-run"`: writes nothing, logs what it would write | `"write"`, after a few hours of dry runs look right in Workers Logs |
| `plan`     | `"paid"`: the app's own limits, on Workers Paid       | unchanged                                                           |

Each run logs one JSON line per step and one summary line (`source: "luma-sync"`).

**Off until the handover.** Two switches keep it from writing:

- `schedule: "off"` deploys the Worker with no Cron Trigger, so nothing can start a run. It answers every request with a 404.
- `mode: "dry-run"` writes nothing, even on a schedule. [`web/tests/sync.test.ts`](../web/tests/sync.test.ts) holds a dry run to leaving every row of every table as it found it, so it can run beside the app's cron.

**One writer.** Production has one writer at a time:

- the app's cron (`/api/cron/luma-sync` in [`app/vercel.json`](../app/vercel.json))
- or the Worker (`schedule: "hourly"` with `mode: "write"`; `workerWrites` in `src/sync.ts`)

[`tests/sync.test.ts`](tests/sync.test.ts) fails when both would write, and Infra CI runs on every change to `app/vercel.json`. So the handover takes two pull requests, with the app's cron out first (below).

**It fails closed.** A run needs every binding:

- `HYPERDRIVE`, from `NEON_SYNC_URL`
- `LUMA_API_KEY` and `X_BEARER_TOKEN`
- `MEDIA`, `MEDIA_ORIGIN` and `IMAGES`

A blank secret counts as missing. Without any of them, it opens no connection and sends no request. It logs one line naming each missing binding, never a value, and fails its invocation, so the Cron Trigger's event shows the failure:

```json
{
  "source": "luma-sync",
  "step": "preflight",
  "status": "failed",
  "mode": "write",
  "missing": ["LUMA_API_KEY"],
  "reason": "The sync Worker ran nothing: it has no LUMA_API_KEY. …"
}
```

A deploy refuses sooner:

- `NEON_SYNC_URL` must be a `site_sync` connection string.
- `LUMA_API_KEY` and `X_BEARER_TOKEN` must be set and not blank.

The secrets reach the Worker with prod's first deploy from the allthings account, on move day ([`scripts/move-day-deploy.sh`](scripts/move-day-deploy.sh)).

**The handover.** Each step is its own pull request. Merge one only once the one before it is deployed:

1. **Dry runs on the schedule.** Set `schedule: "hourly"` and deploy prod (below). Each hour, the Worker logs what it would write while the app's cron writes.
   - Compare a few hours of its `luma-sync` lines in Workers Logs with the app's "Luma calendar sync completed" lines in Vercel's logs.
   - A `preflight` line means a binding is missing: deploy again with it.
2. **The app's cron stops.** Remove the `crons` entry from `app/vercel.json`, and merge between :05 and :55, away from the top of the hour.
   - Merging deploys the app to production on Vercel.
   - Wait until that deployment is ready and the project's Cron Jobs settings list no job.
   - Then wait out any run already started: 60 s at most, its `maxDuration`.
3. **The Worker writes.** Set `mode: "write"`, merge, and deploy prod.
   - CI refuses this while `app/vercel.json` still has the cron.
   - The first write is at the next top of the hour.
   - Each run reads the whole calendar, so an hour skipped during the handover is caught up.
4. `/api/cron/luma-sync` becomes 410 in the legacy-URL manifest (`web/tests/support/legacy-urls.ts`).

To hand back, reverse the order: set `mode: "dry-run"` and deploy prod first, then restore the cron in `app/vercel.json`. CI refuses the cron back while the Worker writes.

**On Workers Free.** The allthings account is on Workers Paid now. On Workers Free, which it was on until October 2026, a Cron Trigger run gets:

- **10 ms of CPU.** Reading the calendar (30-odd events) and converting images will very likely take more. If so, the runtime stops the run with "exceeded CPU": events not written, or images left for later. Each step stays consistent.
- **50 subrequests to the internet.** That covers Luma's feed, its API (hidden venues, descriptions, cover lookups), image downloads and their redirects. `plan: "free"` keeps a run to two venues, two descriptions and two images of each kind, at most 41 subrequests; the rest wait for later runs.
- **1,000 subrequests to Cloudflare services** (Hyperdrive, R2, Images), which a run stays well within.

On Workers Paid, a run hourly or less often gets up to 15 minutes of CPU and 10,000 subrequests, and `plan: "paid"` lifts the per-kind limits.

**Deploying prod.** It now also needs `NEON_SYNC_URL`, `LUMA_API_KEY` and `X_BEARER_TOKEN` (follower counts and the post finder's X search), passed without printing them:

```sh
NEON_SYNC_URL=$(op read "op://Private/allthings site_sync/credential") \
LUMA_API_KEY=$(op read "op://Private/allthings Luma API key/credential") \
X_BEARER_TOKEN=$(op read "op://allthings/allthings X app/Bearer Token") \
  bun run deploy --stage prod
```

From the allthings account (`--profile allthings`), prod also runs the Web Worker, so add `NEON_READER_URL=$(op read "op://Private/allthings site_reader/credential")`.

**The dry run, from a maintainer's machine.** [`web/scripts/sync-dry-run.ts`](../web/scripts/sync-dry-run.ts) runs the same program in `dry-run` mode against the database at `DATABASE_URL`, and writes nothing. The event sync is rehearsed in a transaction that rolls back, and the image phases list what they'd fetch. Run it as `site_sync`, which also proves the role's grants:

```sh
cd web && DATABASE_URL=$(op read "op://Private/allthings site_sync/credential") \
  LUMA_API_KEY=$(op read "op://Private/allthings Luma API key/credential") \
  bun scripts/sync-dry-run.ts
```

## CI credentials

GitHub Actions deploys with an account-owned token that has only the permissions listed in [`ci-token.json`](ci-token.json). [`scripts/ci-token.sh`](scripts/ci-token.sh) applies that file. It creates the token, or updates its policies in place, and writes the value straight into the repository's `CLOUDFLARE_API_TOKEN` secret, so nobody ever sees or copies it. When `alchemy.run.ts` declares more, widen `ci-token.json` in the same PR, then rerun the script after it merges.

The script runs on a maintainer's machine signed in to the allthings account with Cloudflare's CLI, whose sign-in may create account tokens, so no Global API Key or token-minting token exists anywhere. Run it from the repository root:

```sh
NODE_OPTIONS=--dns-result-order=ipv4first bunx cf@1.0.0-beta.12 auth create allthings --no-device   # once per machine
bash infra/scripts/ci-token.sh            # create, or update the policies
bash infra/scripts/ci-token.sh --rotate   # also roll the value and update the secret
```
