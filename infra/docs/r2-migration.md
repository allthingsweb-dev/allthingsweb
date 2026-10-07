# Moving allthings.dev, its media and the new site to the allthings account

Status (Oct 6): Phase 1 is done. R2 and Workers Paid are on in the allthings account (`af627f300cd00c4dca56aacf05bea050`).

- The staged bucket holds all 317 objects (1,372,325,671 bytes), copied in 97 s, and `verify` found every object identical.
- allthings.dev is a pending zone there: `f65e1c6d54e9d2e850cf025190ef8915`, nameservers max/rosalie.ns.cloudflare.com, no records.
- The new site (the prod Web Worker) runs there on its `workers.dev` URL, against production's data. It was deployed on Oct 6 from #162, which makes `ORIGIN` allthings.dev on every stage and has prod deploy the Web Worker in this account. **#162 must be merged before Phase 2**: this runbook's deploys rely on it, and a prod deploy from a main without it would remove the Web Worker.

The new site goes live on allthings.dev with the move. At activation, allthings.dev and www.allthings.dev attach to the prod Web Worker, in place of today's redirect to allthingsweb.dev. allthingsweb.dev keeps serving the old app until [the full cutover](#later-the-full-cutover). That cutover is written down here but not scheduled.

## The one thing to know

**The cutover isn't a step after the domain move. The move itself is the cutover.**

- An R2 custom domain only works in the zone's own account. Cloudflare's docs say the domain "must have been added as a zone in the same account as the R2 bucket".
- When allthings.dev turns active in the allthings account, the old zone is marked Moved Away. Cloudflare's edge then routes media.allthings.dev by the new zone's config.
- From that moment, the old bucket's custom domain no longer serves anything.

**media.allthings.dev can't be attached ahead of time.** R2 refuses a custom domain on a pending zone. It answers "The specified zone id is not valid", found on a prod deploy on Oct 6. So the stack attaches it only once the zone is active (`mediaDomains` in `src/media.ts`), and media.allthings.dev is unserved from activation until the first deploy after it. The image rows store absolute `https://media.allthings.dev/...` URLs, so there is no host to fall back to.

The new bucket must therefore be **full and verified before the move**, and the deploy that attaches it must run **the moment the zone turns active**. Phase 4 starts with a command that waits for activation and deploys at once.

Critical path: copy and verify the delta since Phase 1 → the domain move (earliest Oct 11) → at activation, the prod deploy that attaches media.allthings.dev, allthings.dev and www together. That date is the registrar's 10-day rule; the domain was registered Sep 30.

## What this change adds

- **[`src/media.ts`](../src/media.ts): prod follows the zone.** `productionRole(accountId, zone)` decides:
  - **serve:** allthings.dev is active in the deploying account. This is today's prod: the bucket on the domain, the upload Worker, and the Vercel env. `alchemy plan --stage prod` in the current account shows `[Media] noop`, so nothing changes there.
  - **stage:** the allthings account before the move. The bucket `allthings-media` is declared, and since #162 the Web Worker on its `workers.dev` URL. In serve, the Web Worker also takes allthings.dev and www, and the bucket takes media.allthings.dev. Nothing is attached while the zone is pending, because R2 and Worker custom domains both need an active zone.
  - **refused:** any other account, for example the personal one after the domain has left. Without this, a stray deploy from there would drop the upload Worker and the Vercel env.
  - I checked this with a real plan: `plan --stage prod --profile allthings` reaches the bucket and stops at "Please enable R2". That is the gate.
- **[`scripts/copy-media.ts`](../scripts/copy-media.ts) and [`src/media-copy.ts`](../src/media-copy.ts): the copy.** Commands are `plan`, `copy [--record file]` and `verify [--public https://media.allthings.dev]`.
  - **No token made by hand** ([`scripts/cloudflare-logins.ts`](../scripts/cloudflare-logins.ts)).
    - **Source:** read through Cloudflare's REST API with wrangler's own OAuth login on the account that holds the bucket now (`bunx wrangler login`). The REST API returns the bytes exactly as stored, with their MD5 as the ETag. The login refreshes itself when a run outlasts it.
    - **Target:** written over R2's S3 API with a token that the cf CLI's login on the allthings account (the one `ci-token.sh` uses) creates for that run alone. It may read and write objects in `allthings-media` and nothing else. It lives only in memory and is deleted when the run ends, interrupted or not. Each run checks that the token is gone. `cf` needs `--force` to delete, and without it exits 0 having deleted nothing.
  - **It never overwrites anything.** Every PUT is `If-None-Match: *`. A different object at an existing key is reported as a conflict, never replaced.
  - **It never deletes anything.** The source is only ever read.
  - **Resumable.** A rerun lists both buckets and copies only what's missing. A key that was stored after the listing was taken gets compared, not rewritten.
  - **Checksums.** The bytes read must hash to the source's ETag. R2 refuses the PUT unless they match the `Content-MD5` header. The ETag R2 returns must be that MD5.
  - **Verify.** `verify` re-reads every object from both buckets and compares size, SHA-256 and headers. With `--public` it also checks the bytes visitors actually get.
  - **What's kept.** Content-Type, Cache-Control, Content-Disposition, Content-Encoding, Content-Language, Expires and custom metadata (`x-amz-meta-*`).
  - **Bounded.** Concurrency is bounded (`--concurrency`, default 8). The exit code is non-zero on any conflict or failure. `--record` appends key, size, MD5 and SHA-256 as JSON lines, as an audit trail.
- **What there is to copy** (read on Oct 5 through the REST API): 317 objects, 1,372 MB. Every ETag is an MD5, because none was a multipart upload.
- **Checks.** Infra tests cover:
  - the plan, copying, a rerun as a no-op, conflicts left alone, a corrupt read never written and header preservation
  - the REST listing's pages, metadata and token refresh
  - the token's policies and S3 credentials

  Typecheck, prettier and oxlint pass. On real accounts, the source was listed and read through the REST API, and a target token was created, then deleted and checked gone.

- **Considered and not used.**
  - Sippy: it only takes S3 or GCS as a source.
  - Super Slurper: it supports R2→R2 and Alchemy has `Cloudflare.R2.SuperSlurperJob`, but it needs S3 tokens for both buckets. It also gives no per-object proof we can audit, and has no conditional write. It stays a fallback.

## Erik-only steps

1. ~~**Workers Paid and R2** on the allthings account~~ (done Oct 5).
2. **The move.** Submit it from the personal account (Manage Domain → Configuration), then accept it in the allthings account within 5 days. Cloudflare has no API for it.
3. **Recommended, your call:** an Advanced Certificate (ACM, about $10/month, cancel after) ordered on the pending zone, covering `allthings.dev` and `*.allthings.dev`.
   - Per Cloudflare's docs, it deploys the moment the zone turns active.
   - Since media.allthings.dev, allthings.dev and www can only be attached after activation, the move-day gap is the deploy plus however long the new hostnames' certificates take. The ACM certificate removes the certificate part, leaving about the deploy's minute (see Downtime).
   - It's a cost call, so it's yours; I'd order it.

The zone is already added, and DNSSEC is already off: the .dev registry holds no DS record. The live zone has no ordinary records to recreate. Its apex and www are Wrangler custom domains for esthor/domains' redirect Worker (to allthingsweb.dev). That redirect is not re-homed: after the move, the new site takes both names. [esthor/domains#232](https://github.com/esthor/domains/pull/232) only moves Terraform's zone ownership, and the personal-account Worker is deleted.

**Credentials.** Prod deploys to the allthings account use Alchemy's `allthings` profile (`--profile allthings`). Its refresh failed after its OAuth client dropped a scope. Alchemy 2.0.0-beta.81 fixed that, and Erik signed both profiles in again with `ops/rotate-alchemy-oauth.sh` (Oct 6). Phase 2's deploy proves the profile works on move day, before anything depends on it.

If it fails anyway, deploy with a short-lived account token from the cf CLI's `allthings` login instead, passed as `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Create it and delete it per deploy, as for Phase 1 and the Web Worker (Oct 6). It holds:

- **Account:** Workers Scripts Write, Account Settings Read, Secrets Store Write, Hyperdrive Write, Workers R2 Storage Write.
- **Zones:** Zone Read. Phase 4's deploy also attaches the site's custom domains and the www redirect rule, so it adds Workers Routes Write and Dynamic URL Redirects Write.

Every prod deploy from the allthings account now also needs `NEON_READER_URL`, for the Web Worker's Hyperdrive. Pass it without printing it, as `infra/README.md` shows.

No R2 token is created or stored by hand. The copy runs with the logins a maintainer already has: `bunx wrangler login` on the personal account, and the cf CLI's `allthings` profile.

## Runbook

Run from `infra/` once this has merged. Nothing is passed by hand: the copy uses the two logins above, and prints no credential.

**Phase 1: as soon as R2 is on** (done Oct 5: deploy 21 s, plan 25 s, copy 97 s, verify 71 s)

1. `bun run deploy --stage prod --profile allthings`. This stages the bucket only. The output says the domain isn't attached until the zone is added.
2. `bun scripts/copy-media.ts plan`. This gives the inventory (counts, MB); conflicts must be 0.
3. `bun scripts/copy-media.ts copy --record ../media-copy-1.jsonl`, then `verify`. Both must exit 0.

**Phase 2: the day of the move, before submitting it**

Check first that #162 is on main: `infra/src/web.ts` exports `siteDomain`, and `infra/alchemy.run.ts` deploys the Web Worker in prod.

1. `bun run deploy --stage prod --profile allthings` again, with the secrets Phase 4's step 1 reads. This keeps the stack current on main, and proves the `allthings` profile and every secret work before the move. With the zone still pending, it changes nothing on the bucket: media.allthings.dev is attached in Phase 4. The output says `mediaDomain: not attached until allthings.dev is active in this account`.
2. Ask organizers not to upload media for the next hour.
3. Run `copy` and then `verify` (the delta since Phase 1). Both must exit 0 before the move.
   - A key never changes: the upload Worker refuses a key that exists (409), and every key carries a new UUID. So the delta should only add objects.
   - A conflict means something wrote outside that path, or deleted a key and stored another object under it. The copy never overwrites, so it stops there.
   - Do not submit the move until it is resolved. Compare the two objects, delete the staged one in the allthings account's dashboard (R2 → allthings-media), and rerun `copy` and `verify`.
4. Warm the caches by loading every event, people and home page on the prod Web Worker's `workers.dev` URL, so the `/img` variants are in its edge cache. Vercel's image cache is warm from normal traffic.
   - Check that URL against the old site. The events API and MCP must list the same events, and pages must name allthings.dev as canonical.
   - robots.txt disallows everything there until the Worker answers on allthings.dev.
5. Pick a time with no evening on the calendar within 24 hours.

**Phase 3: the move**

Before submitting, start Phase 4's step 1 (the wait-and-deploy command) in a terminal, so the deploy follows activation within seconds. Then Erik submits the move in the personal account and accepts it in the allthings account. allthings.dev turns active in the allthings account. `dig +short NS allthings.dev` then answers max/rosalie.

From activation, media.allthings.dev, allthings.dev and www are unserved until Phase 4's deploy attaches them. The old zone is marked Moved Away, and its custom domains go with it.

**Phase 4: right after activation**

From activation until step 1's deploy, media.allthings.dev, allthings.dev and www don't answer. Their old custom domains lived in the zone that moved away, and R2 and Worker custom domains need an active zone. Keep the window to the deploy itself.

1. **Wait for activation, then deploy at once.** Start this before the move is submitted. It reads the deploy's secrets and stops if any is missing, checks that the `allthings` profile can still plan, then checks the zone every 10 seconds and runs the prod deploy (now "serve") once it is active. A failing check is reported and, five times in a row, stops it, as does any status other than pending or active:

   ```sh
   (
     set -euo pipefail
     # Read the secrets first, so nothing waits on 1Password at activation.
     # A failed read stops here, and so does an empty value.
     NEON_READER_URL=$(op read "op://Private/allthings site_reader/credential")
     NEON_SYNC_URL=$(op read "op://Private/allthings site_sync/credential")
     LUMA_API_KEY=$(op read "op://Private/allthings Luma API key/credential")
     X_BEARER_TOKEN=$(op read "op://allthings/allthings X app/Bearer Token")
     : "${NEON_READER_URL:?empty}" "${NEON_SYNC_URL:?empty}" "${LUMA_API_KEY:?empty}" "${X_BEARER_TOKEN:?empty}"
     export NEON_READER_URL NEON_SYNC_URL LUMA_API_KEY X_BEARER_TOKEN
     # Prove the allthings profile can still deploy before waiting on it.
     bun run plan --stage prod --profile allthings >/dev/null
     # Wait for the zone to turn active. A failed check is reported, and five
     # in a row stop the wait, so a broken check can't silently hold the
     # deploy back; any status but pending or active stops it too.
     failures=0
     while true; do
       if zone=$(CLOUDFLARE_ACCOUNT_ID=af627f300cd00c4dca56aacf05bea050 NODE_OPTIONS=--dns-result-order=ipv4first \
           bunx cf@1.0.0-beta.12 --profile allthings zones get --zone f65e1c6d54e9d2e850cf025190ef8915 2>/dev/null) &&
         status=$(jq -er '(.result // .).status' <<<"$zone"); then
         failures=0
         case "$status" in
           active) break ;;
           pending) sleep 10 ;;
           *) echo "allthings.dev is $status, not pending or active: stopping" >&2; exit 1 ;;
         esac
       else
         failures=$((failures + 1))
         echo "zone check failed ($failures in a row)" >&2
         if ((failures >= 5)); then echo "zone check keeps failing: stopping" >&2; exit 1; fi
         sleep 10
       fi
     done
     bun run deploy --stage prod --profile allthings
   )
   ```

   The deploy brings up:
   - **media.allthings.dev** on the new bucket.
   - **The new site on allthings.dev:** the prod Web Worker's custom domain. www.allthings.dev gets a 301 to the apex (path and query kept) from a redirect rule in the zone, which runs before the Worker.
   - **The upload Worker** in the allthings account (new URL and token). It runs its put/delete check.
   - **The sync Worker,** its schedule still off.
   - **Vercel env:** `MEDIA_UPLOAD_URL`, `MEDIA_UPLOAD_TOKEN` and `MEDIA_PUBLIC_URL` are written to it.

2. Check media:
   - `curl -sI https://media.allthings.dev/<a few keys>` must return 200 with a valid certificate.
   - `verify --public https://media.allthings.dev` must exit 0.
3. Check the site:
   - `curl -sI https://allthings.dev/` must return 200 with a valid certificate.
   - `curl -sI 'https://www.allthings.dev/events?x=1'` must return 301 to `https://allthings.dev/events?x=1`.
   - robots.txt must now allow crawlers.
   - Event pages, the events API and an MCP `list_events` call (a POST to `/mcp`) must answer as they did on `workers.dev`.
4. **esthor/domains** ([#232](https://github.com/esthor/domains/pull/232)), Terraform only:
   - Move Terraform's state to the new zone (`state rm`, then the `--expect-import` plan, then apply).
   - Delete the personal-account Worker `domains-allthings-redirect`. Its custom domains went with the old zone, so it no longer serves anything.
5. **Redeploy production on Vercel.** Changed env only reaches new deployments. Until then, uploads still go to the old bucket.
6. Run `copy` again for anything uploaded to the old bucket before the redeploy, then `verify --public`.
7. Run an end-to-end check: one upload through the admin, visible on media.allthings.dev and as an `/img` variant.
8. **Point clients at the new host.** These are small PRs once step 3 passes, not before. Before activation, allthings.dev still redirects to allthingsweb.dev, and a redirect drops an MCP POST. After it, the new site answers on allthings.dev and allthingsweb.dev keeps serving the old app, so clients can switch to `https://allthings.dev/mcp`.
   - The CLI's default endpoint becomes `https://allthings.dev/mcp` (`siteOrigin` in `cli/src/config.ts`, and `core/scripts/fixtures.ts`).
   - `infra/README.md`'s "default profile until the domain moves" sentence becomes past tense.
   - The agent plugin's MCP server becomes `https://allthings.dev/mcp` (`plugins/allthings/mcp.json`, and the URL its test in `app/tests/agent-plugin.test.ts` expects).

**Phase 5: after**

- **The old bucket.** Keep the old bucket and every original untouched. The stack declares it `RemovalPolicy.retain()`, and the script never deletes. Decide later whether it is ever deleted. My suggestion is not before the 30-day transfer lock ends.
- **The old prod stack.** Never run `alchemy destroy --stage prod` with the default profile. Destroy plans nothing, so the account guard can't stop it, and it would remove the old upload Worker (harmless after Phase 4, but noisy).
- **Old upload Worker.** Leave it, or delete it by hand after the Vercel redeploy.
- **Tokens.** None to clean up: each copy run deleted its own. `cf accounts tokens list --profile allthings` shows any left by a run that crashed outright, named "allthings media copy <time>".

## Downtime: what can still go wrong

media.allthings.dev, allthings.dev and www are all unserved from activation until Phase 4's deploy attaches them. R2 refuses a custom domain on a pending zone, so this window can't be closed in advance, only kept short:

- **The deploy:** under a minute. Phase 4's command starts it within 10 seconds of activation.
- **Certificates:**
  - With the ACM certificate, none: it is live at activation and covers every name.
  - Without it, each new hostname waits for its own certificate, usually minutes.

Most image traffic rides caches through that window:

- the Worker's `/img` variants in `caches.default`
- Vercel's optimized images
- browser caches

Direct links to originals, such as old link previews, fail for those minutes. allthings.dev has only ever redirected to allthingsweb.dev, so little links to it yet.

**There is no rollback for the zone once it moves.** The registration is transfer-locked for 30 days after the move. All de-risking therefore happens before the move:

- the copy is verified
- Phase 4's deploy is ready, and waits for activation

The source bucket stays intact, so any object can be re-copied at any time.

## Later: the full cutover

This isn't scheduled; Erik calls it. Until then allthingsweb.dev is untouched. Its DNS stays at name.com, and the old app on Vercel keeps serving the site, sign-in, the admin and the hourly sync. Each step is its own PR, in this order:

1. **The sync moves to the sync Worker.** In `infra/src/sync.ts`:
   - Set `schedule: "hourly"` with `mode: "dry-run"` first. Compare an hour's logged work with the Vercel cron's writes.
   - Then hand over, so the two never write in the same hour:
     1. Remove the cron from `app/vercel.json` and deploy the app.
     2. Wait for any run already started to finish. A run lasts at most its 60 s `maxDuration`.
     3. Set `mode: "write"` and deploy prod.

     Each run reads the whole calendar, so an hour skipped during the handover is caught up by the next run.

   - `/api/cron/luma-sync` becomes 410 in the legacy-URL manifest (`web/tests/support/legacy-urls.ts`).

2. **Sign-in and the admin retire.** The manifest marks these paths pending today. They become 410:
   - `/handler/*` (Stack Auth)
   - `/profile` and `/api/v1/profile`
   - `/admin` and `/api/v1/admin/*`

   With the admin gone, the upload Worker has no caller. Remove `MediaUpload`, its check and the Vercel env writes from the stack. The sync Worker still stores Luma's images in the bucket itself.

3. **allthingsweb.dev redirects to allthings.dev.** The old Next app does it, behind one flag that ships off. No DNS change is needed.
   - **The code.** `app/src/middleware.ts` runs on every path. With `ALLTHINGS_DEV_REDIRECT=on`, it answers each request with a redirect from `app/src/lib/cutover/redirect.ts`; with the variable unset or `off`, it redirects nothing.
   - **One hop.** Where the Worker would only redirect again, the redirect goes straight to its target:
     - an event's long slug goes to its short link, looked up in the database;
     - `/speakers` goes to `/people`, and `/rss.xml` to `/rss`;
     - a trailing slash is dropped;
     - the old link-preview images go to `/og/…` cards;
     - `/_next/image` for a photo on the media origin goes to the photo.
   - **Everything else** goes to the same path and query on allthings.dev. That includes the API, `/mcp`, `/r/*` and the retired paths, and the Worker answers each as the legacy-URL manifest says.
   - **Status codes.** GET and HEAD get 301. Any other method gets 308, which keeps a POST's method and body. Each redirect is cached for an hour, so turning the flag back off takes hold within one.
   - **Person anchors.** A fragment never reaches a server. The browser keeps `#p-<id>` across the redirect, and allthings.dev/people still has those anchors.
   - **No drift.** `web/tests/cutover.test.ts` holds every pattern in the manifest to its exact target, so the two can't drift apart.
   - **Ordering.** Steps 1 and 2 come first, so nothing the app still serves is redirected away.
   - **The flip:**
     1. Set it: `vercel env add ALLTHINGS_DEV_REDIRECT production`, with the value `on`.
     2. Redeploy production: Vercel applies an env change only to new deployments. Use `vercel redeploy` on the latest production deployment, or the Vercel MCP's `create_deployment` with its deployment id.
     3. Check `curl -sI https://allthingsweb.dev/speakers`: it should answer `301` with `location: https://allthings.dev/people`. Check an event's long slug too, which should go to its short link.
   - **Undo.** Set the variable to `off` and redeploy. Browsers that cached a redirect follow it for at most an hour.
4. **Vercel retires.** allthingsweb.dev's redirects then need a home off Vercel:
   - Add allthingsweb.dev as a zone in the allthings account and point name.com's nameservers at it. This is the only DNS change, and it waits until this step.
   - Add allthingsweb.dev and www.allthingsweb.dev to the site's `redirects` in `siteDomain` (`infra/src/web.ts`). They become 301s to allthings.dev, with path and query kept, and the Worker's legacy handling does the rest.
   - Delete the Vercel project and its env, then Stack Auth's project and the app's Sentry project.
   - Delete `app/` and its workflow. The parity tests that hold core to the app's schemas go with it, and the contract's "Event page on allthingsweb.dev." description changes to allthings.dev.

## Open questions and assumptions

1. **R2 on a pending zone.** Settled on Oct 6: R2 refuses it ("The specified zone id is not valid"), so the stack attaches media.allthings.dev only once the zone is active.
2. **When the zone activates.** That a Registrar move activates the new account's zone promptly is unverified. I'll watch the zone's status during Phase 3.
3. **allthings.dev's certificate after activation.** It is unverified that Worker custom domains on a just-activated zone get their edge certificate within minutes. I'll time it in Phase 4.
4. **Pre-existing drift.** `plan --stage prod` on main already shows `[MediaUpload] update` (an undeployed change on main). It's moot after Phase 4, which deploys a fresh upload Worker in the allthings account.
5. **Only the upload Worker writes media today** (the app and the reencode script both go through it). If anything else writes to the bucket, Phase 4's re-copy covers it, as long as it runs after that writer stops.
