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
- **Upload Worker:** `prod` only. Stores and deletes media for the app while it runs on Vercel, for core's scripts, and for the Sync Worker until allthings.dev moves into its account. The bucket is a binding and callers present a token Alchemy generates. It never replaces an object (409 for a key that exists): the site caches variants of each photo for a year under URLs derived from its key, so a replacement goes under a new key. Every deploy proves uploads work by storing and deleting one object.
- **Web Worker:** `web/` (the public API, the MCP server, the home page and `/brand`), on every stage; previews run nothing else. In `prod` it runs only in the allthings account: on its `workers.dev` URL until allthings.dev is active there, then on `allthings.dev`, with `www.allthings.dev` redirected (301, path and query kept) to it. Its `ORIGIN` is `https://allthings.dev` on every stage, so canonical URLs, the sitemap, feeds, calendar files, structured data and link previews always name allthings.dev, and robots.txt admits crawlers only on that host. Alchemy bundles it with web's dependencies and uploads `web/dist/public` as its static assets, so run `bun install` at the repository root and `bun run build` in `web/` before planning or deploying. `bun run plan` and `bun run deploy` check first ([`scripts/web-build.ts`](scripts/web-build.ts)) and stop at once without it: Alchemy itself would wait at "Computing plan" with no end.
- **Draft preview:** `prod` only, in the allthings account, while `PREVIEW.deploy` is on ([`src/preview.ts`](src/preview.ts)). Its own Worker ([`web/src/preview/`](../web/src/preview/app.ts)) renders each draft evening's real page for the organizers, so the Web Worker never reads a draft. Cloudflare Access sits in front of it: an application whose one policy admits `PREVIEW_VIEWERS`, signing in with a one-time PIN sent to their email (the only login it allows), which the Worker enrolls in. The Worker also checks the token Access signs (team keys, this application's audience, its times and an email) and refuses anything else. The organizers see every draft; anyone else sees only the evenings they are invited to (core's README, "Collaborating on a draft"), read through a `COLLAB` Hyperdrive as `draft_collab` that never caches, so a revoked invitation is refused on the next request. What collaborators write comes in by forms signed with `COLLAB_FORM_KEY`, a key Alchemy makes once and keeps in state, bound to nothing but this Worker. A round's questions and answer key are sealed with `COLLAB_ANSWERS_KEY` before they are stored. That key isn't Alchemy's: the studio opens rounds with it too, so [`scripts/collab-answers-key.ts`](scripts/collab-answers-key.ts) makes it into 1Password ("allthings collab answers key"), and a prod deploy needs it as `COLLAB_ANSWERS_KEY=$(op read "op://allthings/allthings collab answers key/credential")`. `--rotate` keeps the old key as "(previous)"; it refuses while a previous one is there, since rounds sealed with that would stop opening, unless `--drop-previous` says so. The Worker and the studio open older rounds with it as `COLLAB_ANSWERS_PREVIOUS_KEY`, which the stack doesn't bind yet: the first rotation adds that binding in its own pull request. Every answer is `no-store` and `noindex`; its pages may post forms to the preview itself, and still run no script. Access needs the account's Zero Trust organization (`allthingsdev.cloudflareaccess.com`; `allthings` is taken). A stack that declares an Access application where Zero Trust is off fails to plan, so `PREVIEW.deploy` is the switch: on, now that the account has it.
- **Images:** the Web Worker's `IMAGES` binding, wherever it runs. It resizes and re-encodes the photos on `media.allthings.dev` into the variants the pages load (`/img/…`, see [`web/src/images/variants.ts`](../web/src/images/variants.ts)), and the Worker keeps each in the edge cache. It is a binding, not a resource: transformations are billed to the allthings account per unique transformation per month, the first 5,000 free. Past those, new variants fail and the Worker sends the originals instead.
- **Hyperdrive:** wherever the Web Worker runs. Its `HYPERDRIVE` binding, in front of production's Neon database as the read-only `site_reader` role, from `NEON_READER_URL` (see [Accounts and stages](#accounts-and-stages)).
- **Vercel env:** `prod` deploys write `MEDIA_UPLOAD_URL`, `MEDIA_UPLOAD_TOKEN` and `MEDIA_PUBLIC_URL` to every Vercel environment (the token is sensitive except in development, where Vercel doesn't allow it) with the Vercel CLI, so it needs to be signed in (`bunx vercel login`).
- **Sync Worker:** `prod` only, and only in the allthings account, whether allthings.dev is pending or active there. The hourly Luma sync ([`web/src/sync/`](../web/src/sync/worker.ts)), off Vercel's cron and outside the site's Worker. It has its own bindings:
  - a `Writer` Hyperdrive in front of production as `site_sync`, from `NEON_SYNC_URL`, which never caches
  - the media bucket and the Images binding
  - `LUMA_API_KEY` as a secret: hidden venues, drafts, descriptions and cover lookups
  - `X_BEARER_TOKEN` as a secret: follower counts and the post finder's X search, billed per post it reads

  It writes every hour, as the sync's one writer since the app's cron stopped, and runs nothing without every one of them: see [The Luma sync](#the-luma-sync).

## Accounts and stages

allthings has its own Cloudflare account (`af627f300cd00c4dca56aacf05bea050`), so a deploy credential can only touch allthings resources. Every stage but `prod` deploys there and runs only the Web Worker, reading production's data through a Hyperdrive of its own:

- **`pr-<number>`:** one per pull request, deployed by [`deploy.yaml`](../.github/workflows/deploy.yaml) on every push and destroyed, Hyperdrive included, when the PR closes. Its URL is in the PR's deployment and the run summary.
- **`staging`:** main, deployed on every merge.
- **Your own stage:** `bun run deploy --profile allthings` from a machine signed in with `bun alchemy profile edit --profile allthings --add Cloudflare`, with `NEON_READER_URL` in the environment (below).

Each stage's Hyperdrive connects to production's Neon branch as `site_reader`, which may only `SELECT` the tables the public site reads and starts every transaction read-only, so nothing outside prod can write production's data or read anything else. The stack refuses a `NEON_READER_URL` for any other role, including Neon's own `reader`, which belongs to `neon_superuser` and can write. [`scripts/site-reader.ts`](scripts/site-reader.ts) creates the role or rotates its password, and stores the connection string in the repository secret and 1Password. Previews only read, so Hyperdrive caches query results for 60 seconds and may serve them up to 15 seconds stale while it refreshes them; each stage holds at most about 5 connections to Neon. CI deploys with the `NEON_READER_URL` repository secret, a direct (not pooled) connection string. On your machine, pass the same string without printing it:

```sh
NEON_READER_URL=$(op read "op://allthings/allthings site_reader/credential") \
  bun run deploy --profile allthings
```

Every `op://` reference in this repository reads the `allthings` 1Password vault. Your own `op` session (the 1Password desktop app integration) can read it, and agents read it with `OP_SERVICE_ACCOUNT_TOKEN`.

`alchemy destroy` needs no `NEON_READER_URL`.

The hourly Luma sync writes production as `site_sync`, a second login role made the same way by [`scripts/site-sync.ts`](scripts/site-sync.ts):

- It holds only the column privileges the sync's statements use: upserting events from Luma's feed, and storing missing covers, profile photos and post images.
- It has no `DELETE`, and no access to any table the sync doesn't touch.
- Its statements, lock waits and idle transactions time out at 30 seconds or less.

[`core/tests/site-sync.test.ts`](../core/tests/site-sync.test.ts) runs the sync as the role and checks everything else is refused. The connection string is in the `NEON_SYNC_URL` repository secret and the "allthings site_sync" 1Password item.

The draft preview reads and writes draft collaboration as `draft_collab` (see core's README, "Collaborating on a draft"), a third login role made the same way by [`scripts/draft-collab.ts`](scripts/draft-collab.ts):

- It holds column grants on planning's collaboration tables alone: it reads what the panel shows and adds what collaborators hand in. It has no UPDATE, DELETE or TRUNCATE anywhere.
- It has no privilege on `planning.collaborators`. It learns who is on an evening only through the `planning.collab_*` functions, which show emails to that evening's organizers alone.
- On `public`, it may read only an evening's id, slug, draft flag and end.
- Row security applies to every row it touches.
- Its statements, lock waits and idle transactions time out at 15 seconds or less.

[`core/tests/draft-collab.test.ts`](../core/tests/draft-collab.test.ts) makes the role with the script's statements. It checks that what the preview does succeeds, that everything else is refused, and that the role's privileges in the catalog are exactly the script's. The connection string goes into the `NEON_COLLAB_URL` repository secret and the "allthings draft_collab" 1Password item.

The event studio's commands (`bun run plan`, `readiness`, `luma`, `social`, `posts`, `photos` and the rest; core's README, "The studio's connection") connect as `studio`, a fourth login role made the same way by [`scripts/studio.ts`](scripts/studio.ts):

- It holds exactly what those commands' statements use, each grant listed with the command that needs it: planning's tables but the collaboration's, and on `public` reads of only tables `site_reader` reads and writes of only the columns the studio writes.
- It has no DDL, no ownership, no function, no TRUNCATE and no BYPASSRLS, so migrations, and the collaboration's tables, which have row security, stay the owner's.
- Its statements, lock waits and idle transactions time out at 30 seconds or less.

[`core/tests/studio-role.test.ts`](../core/tests/studio-role.test.ts) holds every column of `public` and `planning` to the script's grants, both ways, and the role's catalog privileges to its list exactly; core's `bun run test:studio` runs the studio's suites as the role. Its connection string goes only into the "allthings studio" 1Password item, never a repository secret: nothing in CI connects as it. The maintainer runs it from the repository root, first as a plan, then to apply:

```sh
OWNER_URL=$(bunx neonctl@latest connection-string br-round-dust-a6avtg0r \
  --project-id wispy-sea-75401301 --role-name neondb_owner --database-name neondb) \
  bun infra/scripts/studio.ts --dry-run
OWNER_URL=$(bunx neonctl@latest connection-string br-round-dust-a6avtg0r \
  --project-id wispy-sea-75401301 --role-name neondb_owner --database-name neondb) \
  OP_SERVICE_ACCOUNT_TOKEN=$(security find-generic-password -s allthings-op -w) \
  bun infra/scripts/studio.ts --apply
```

`--dry-run` makes the role and runs every grant in a transaction that is rolled back, and prints how its privileges would change and where its credential would go. `--apply` does it, then checks it: the catalog holds exactly `STUDIO_GRANTS`, and the connection string read back from 1Password signs in as `studio`.

The database owner's connection is for migrations only. It is never stored in the vault or a repository secret: the maintainer fetches it with neonctl, as above, whenever it is needed.

[`vault-items.json`](vault-items.json) lists the allthings vault's items and their fields (titles and labels, never values). `core/tests/vault.test.ts` fails on an `op://` reference to anything it doesn't list, and on a documented studio command that doesn't read "allthings studio". An item still to be made is marked `pending`. `bun infra/scripts/vault-items.ts` checks the list against the vault itself.

`prod` (media, the upload Worker and the Vercel env) follows the allthings.dev zone. Where the zone is active, prod serves: the bucket answers on `media.allthings.dev`, and the Workers and the Vercel env follow it. That is the `default` profile's account until the domain moves. In the allthings account before then, `bun run deploy --stage prod --profile allthings` stages the bucket (without `media.allthings.dev`: R2 refuses a custom domain on a pending zone) and runs the Web Worker on its `workers.dev` URL against production's data (it needs `NEON_READER_URL`). It also runs the Sync Worker, which needs no domain (it needs `NEON_SYNC_URL`, `LUMA_API_KEY` and `X_BEARER_TOKEN`, and until the move `MEDIA_UPLOAD_URL` and `MEDIA_UPLOAD_TOKEN`). Once the zone is active there, the same deploy attaches `media.allthings.dev` to the bucket and `allthings.dev` and `www.allthings.dev` to the Web Worker. The `default` account never runs the Web Worker or the Sync Worker: until the move its zone answers allthings.dev with [esthor/domains](https://github.com/esthor/domains)' redirect. Any other account is refused, so a deploy from an account the domain has left can't drop the upload Worker or the Vercel env.

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

| `SYNC.`    | Now                                                            | Then                                  |
| ---------- | -------------------------------------------------------------- | ------------------------------------- |
| `schedule` | `"hourly"`: `0 * * * *`, as the app's cron was                 | unchanged                             |
| `mode`     | `"write"`: the sync's one writer, since the app's cron stopped | `"dry-run"` only to hand back (below) |
| `plan`     | `"paid"`: the app's own limits, on Workers Paid                | unchanged                             |

Each run logs one JSON line per step and one summary line (`source: "luma-sync"`).

**It writes every hour.** The handover is done (below):

- `schedule: "hourly"` gives it a Cron Trigger at the top of every hour, as the app's cron has. It answers every request with a 404. It runs in the allthings account alone, from prod's first deploy there, whether allthings.dev is pending or active (`syncPlan` in `src/sync.ts`). `schedule: "off"` would deploy it with no Cron Trigger at all.
- `mode: "write"` writes. `mode: "dry-run"` would write nothing, even on a schedule: [`web/tests/sync.test.ts`](../web/tests/sync.test.ts) holds a dry run to leaving every row of every table as it found it, so it could run beside another writer.
- A dry run never asks X, which bills each read: it skips the follower counts, and searches Bluesky alone for posts.

**Images never wait for the move.** Every image is recorded at its URL on media.allthings.dev, which serves the bucket of the account where allthings.dev is active, so the Sync Worker stores into that bucket (`SYNC_IMAGES`, from `syncPlan`):

- `"upload"` while allthings.dev is pending in the allthings account: through the upload Worker beside the bucket that serves it now, in the account that still has the domain, as the app and core's scripts do. The deploy then needs that Worker's `MEDIA_UPLOAD_URL` and `MEDIA_UPLOAD_TOKEN` (below).
- `"bucket"` once it's active there: through the Sync Worker's own `MEDIA` binding. The move-day deploy switches it, and no longer needs the two.

The move can take as long as it takes. The deploy that switches updates the same Worker in place: its name is generated once and kept.

**One writer.** Production has one writer at a time:

- the app's cron (`/api/cron/luma-sync` in [`app/vercel.json`](../app/vercel.json))
- or the Worker (`schedule: "hourly"` with `mode: "write"`; `workerWrites` in `src/sync.ts`)

[`tests/sync.test.ts`](tests/sync.test.ts) fails when both would write, and Infra CI runs on every change to `app/vercel.json`. So the handover takes two pull requests, with the app's cron out first (below).

**It fails closed.** A run needs every binding:

- `HYPERDRIVE`, from `NEON_SYNC_URL`
- `LUMA_API_KEY` and `X_BEARER_TOKEN`
- `MEDIA`, `MEDIA_ORIGIN` and `IMAGES`
- `SYNC_IMAGES`, `"bucket"` or `"upload"`, and for `"upload"` also `MEDIA_UPLOAD_URL` (an https root URL, nothing after the host) and `MEDIA_UPLOAD_TOKEN`

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

The secrets reach the Worker with its first prod deploy from the allthings account, whether allthings.dev is pending or active there (below, "Deploying prod").

**The handover.** Each step is its own pull request. Merge one only once the one before it is deployed:

1. **Dry runs on the schedule** (done, 2026-10-07). `schedule: "hourly"`. Deploy prod (below). Each hour, the Worker logs what it would write while the app's cron writes.
   - Compare a few hours of its `luma-sync` lines in Workers Logs (below, "Reading its logs") with the app's "Luma calendar sync completed" lines in Vercel's logs.
   - A `preflight` line means a binding is missing: deploy again with it.
2. **The app's cron stops** (done, #206). Remove the `crons` entry from `app/vercel.json`, and merge between :05 and :55, away from the top of the hour.
   - Merging deploys the app to production on Vercel.
   - Wait until that deployment is ready and the project's Cron Jobs settings list no job.
   - Then wait out any run already started: 60 s at most, its `maxDuration`.
3. **The Worker writes** (this step's pull request). Set `mode: "write"`, merge, and deploy prod.
   - CI refuses this while `app/vercel.json` still has the cron.
   - The first write is at the next top of the hour.
   - Each run reads the whole calendar, so an hour skipped during the handover is caught up.
4. `/api/cron/luma-sync` becomes 410 in the legacy-URL manifest (`web/tests/support/legacy-urls.ts`).

To hand back, reverse the order: set `mode: "dry-run"` and deploy prod first, then restore the cron in `app/vercel.json`. CI refuses the cron back while the Worker writes.

**Reading its logs.** Workers Logs keeps each run's lines (Alchemy turns them on for every Worker), so a few hours of dry runs can be read at once. A prod deploy prints the Worker's script name as `syncWorker`; or look it up. With the cf CLI signed in to the allthings account (see [CI credentials](#ci-credentials)), from `infra/`:

```sh
export CLOUDFLARE_ACCOUNT_ID=af627f300cd00c4dca56aacf05bea050 NODE_OPTIONS=--dns-result-order=ipv4first
SYNC_WORKER=$(bunx cf@1.0.0-beta.12 --profile allthings workers list 2>/dev/null |
  jq -r '.. | .name? // empty' | grep '^allthings-sync-prod-')
now=$(($(date +%s) * 1000))   # the last six hours, up to 500 lines, nothing saved
body=$(jq -nc --arg svc "$SYNC_WORKER" --argjson to "$now" --argjson from "$((now - 6 * 3600000))" \
  '{queryId: "luma-sync", timeframe: {from: $from, to: $to}, view: "events", limit: 500, dry: true,
    parameters: {filters: [{key: "$metadata.service", operation: "eq", type: "string", value: $svc}]}}')
bunx cf@1.0.0-beta.12 --profile allthings observability telemetry query --body "$body" 2>/dev/null |
  jq -c '.events.events | sort_by(.timestamp)[] | [.source, (.source.message? | fromjson?)][]
    | objects | select(.source == "luma-sync")'
```

Each line is one step's JSON, `start` to `summary`. To watch the next run live instead, `CLOUDFLARE_ACCOUNT_ID=af627f300cd00c4dca56aacf05bea050 bunx wrangler tail "$SYNC_WORKER" --format json` (signed in with `bunx wrangler login`) shows it at the top of the hour.

**On Workers Free.** The allthings account is on Workers Paid now. On Workers Free, which it was on until October 2026, a Cron Trigger run gets:

- **10 ms of CPU.** Reading the calendar (30-odd events) and converting images will very likely take more. If so, the runtime stops the run with "exceeded CPU": events not written, or images left for later. Each step stays consistent.
- **50 subrequests to the internet.** That covers Luma's feed, its API (hidden venues, descriptions, cover lookups), image downloads and their redirects. `plan: "free"` keeps a run to two venues, two descriptions and two images of each kind, at most 41 subrequests; the rest wait for later runs.
- **1,000 subrequests to Cloudflare services** (Hyperdrive, R2, Images), which a run stays well within.

On Workers Paid, a run hourly or less often gets up to 15 minutes of CPU and 10,000 subrequests, and `plan: "paid"` lifts the per-kind limits.

**Deploying prod.** It now also needs `NEON_SYNC_URL`, `LUMA_API_KEY` and `X_BEARER_TOKEN` (follower counts and the post finder's X search), and while allthings.dev is pending in the allthings account the upload Worker's `MEDIA_UPLOAD_URL` and `MEDIA_UPLOAD_TOKEN` ("allthings media upload" in the `allthings` vault), passed without printing them:

```sh
MEDIA_UPLOAD_URL=$(op read "op://allthings/allthings media upload/url") \
MEDIA_UPLOAD_TOKEN=$(op read "op://allthings/allthings media upload/token") \
NEON_SYNC_URL=$(op read "op://allthings/allthings site_sync/credential") \
LUMA_API_KEY=$(op read "op://allthings/allthings Luma API key/credential") \
X_BEARER_TOKEN=$(op read "op://allthings/allthings X app/Bearer Token") \
  bun run deploy --stage prod
```

From the allthings account (`--profile allthings`), prod also runs the Web Worker, so add `NEON_READER_URL=$(op read "op://allthings/allthings site_reader/credential")`, and the draft preview, so add `NEON_COLLAB_URL=$(op read "op://allthings/allthings draft_collab/credential")`. The stack refuses a `NEON_COLLAB_URL` for any role but `draft_collab`.

**The dry run, from a maintainer's machine.** [`web/scripts/sync-dry-run.ts`](../web/scripts/sync-dry-run.ts) runs the same program in `dry-run` mode against the database at `DATABASE_URL`, and writes nothing. The event sync is rehearsed in a transaction that rolls back, and the image phases list what they'd fetch. Run it as `site_sync`, which also proves the role's grants:

```sh
cd web && DATABASE_URL=$(op read "op://allthings/allthings site_sync/credential") \
  LUMA_API_KEY=$(op read "op://allthings/allthings Luma API key/credential") \
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

## The studio's Zero Trust token

Draft collaboration's edge (core's README, "Collaborating on a draft") is kept by the studio, not by Alchemy:

- The preview's Access policy admits the Zero Trust email list "allthings draft collaborators" besides the organizers, by its id, `COLLABORATOR_LIST_ID` in [`src/preview.ts`](src/preview.ts).
- `bun run collab` sets the list's items to every active invitation whenever it invites or revokes. A revocation also ends that person's Access sessions.
- Alchemy only names the list: it reconciles a list's items as a full set on every deploy, which would empty this one.

The studio calls Cloudflare's API with an account-owned token that has only what [`zero-trust-token.json`](zero-trust-token.json) lists:

- **Zero Trust Write:** the narrowest group that writes Gateway lists.
- **Access: Organizations Revoke:** ends sessions, nothing else.

[`scripts/zero-trust-token.sh`](scripts/zero-trust-token.sh) applies that file the way `ci-token.sh` applies its own:

- It creates the token, or updates its policies in place.
- The value goes straight from Cloudflare into 1Password ("allthings zero trust" in the `allthings` vault, field `credential`), never printed.
- Then, with the token, it makes the list if it isn't there and prints the list's id, which isn't a secret. Set `COLLABORATOR_LIST_ID` to it in a pull request of its own, and deploy prod.

Run it from the repository root, with cf signed in to the allthings account and op signed in through `OP_SERVICE_ACCOUNT_TOKEN`:

```sh
bash infra/scripts/zero-trust-token.sh            # create, or update the policies; make the list if it's missing
bash infra/scripts/zero-trust-token.sh --rotate   # also roll the value and store it
```
