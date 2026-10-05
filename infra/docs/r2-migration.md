# Moving media to the allthings account

Status (Oct 5): Phase 1 is done. R2 and Workers Paid are on in the allthings account (`af627f300cd00c4dca56aacf05bea050`).

- The staged bucket holds all 317 objects (1,372,325,671 bytes), copied in 97 s, and `verify` found every object identical.
- allthings.dev is a pending zone there: `f65e1c6d54e9d2e850cf025190ef8915`, nameservers max/rosalie.ns.cloudflare.com, no records.

## The one thing to know

**The cutover isn't a step after the domain move. The move itself is the cutover.**

- An R2 custom domain only works in the zone's own account. Cloudflare's docs say the domain "must have been added as a zone in the same account as the R2 bucket".
- When allthings.dev turns active in the allthings account, the old zone is marked Moved Away. Cloudflare's edge then routes media.allthings.dev by the new zone's config.
- From that moment, the old bucket's custom domain no longer serves anything.

So for zero downtime, the new bucket must be **full, verified, and already attached to media.allthings.dev before the move happens**. If R2 is still off on Oct 11, the move takes media offline. The image rows store absolute `https://media.allthings.dev/...` URLs, so there is no host to fall back to.

Critical path: attach media.allthings.dev to the pending zone → copy and verify the delta since Phase 1 → the domain move (earliest Oct 11), then re-home the apex/www redirect right after activation. That date is the registrar's 10-day rule; the domain was registered Sep 30.

## What this change adds

- **[`src/media.ts`](../src/media.ts): prod follows the zone.** `productionRole(accountId, zone)` decides:
  - **serve:** allthings.dev is active in the deploying account. This is today's prod: the bucket on the domain, the upload Worker, and the Vercel env. `alchemy plan --stage prod` in the current account shows `[Media] noop`, so nothing changes there.
  - **stage:** the allthings account before the move. Only the bucket `allthings-media` is declared. Once the zone has been added there (pending), media.allthings.dev is attached ahead of time, so it serves from the instant the zone turns active.
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
3. **Optional, your call:** an Advanced Certificate (ACM, about $10/month, cancel after) ordered on the pending zone.
   - Per Cloudflare's docs, it deploys the moment the zone turns active. That removes the remaining TLS gap (see Downtime).
   - It's a cost and taste call, so I haven't decided it.

The zone is already added, and DNSSEC is already off: the .dev registry holds no DS record. The live zone has no ordinary records to recreate. Its apex and www are Wrangler custom domains for esthor/domains' redirect Worker, which [esthor/domains#232](https://github.com/esthor/domains/pull/232) re-homes to the allthings account right after the move.

`ops/rotate-alchemy-oauth.sh` signs both Alchemy profiles in again. That fixes the `allthings` profile's refresh, which fails since its OAuth client dropped a scope. Until then, prod deploys to the allthings account run with a short-lived account token from the cf CLI's `allthings` login, created and deleted per deploy, as Phase 1's did.

No R2 token is created or stored by hand. The copy runs with the logins a maintainer already has: `bunx wrangler login` on the personal account, and the cf CLI's `allthings` profile.

## Runbook

Run from `infra/` once this has merged. Nothing is passed by hand: the copy uses the two logins above, and prints no credential.

**Phase 1: as soon as R2 is on** (done Oct 5: deploy 21 s, plan 25 s, copy 97 s, verify 71 s)

1. `bun run deploy --stage prod --profile allthings`. This stages the bucket only. The output says the domain isn't attached until the zone is added.
2. `bun scripts/copy-media.ts plan`. This gives the inventory (counts, MB); conflicts must be 0.
3. `bun scripts/copy-media.ts copy --record ../media-copy-1.jsonl`, then `verify`. Both must exit 0.

**Phase 2: the day of the move, before submitting it**

1. `bun run deploy --stage prod --profile allthings` again. The zone is now in the account, so this attaches media.allthings.dev to the new bucket on the pending zone.
   - Check in the dashboard that the bucket's custom domain shows media.allthings.dev.
   - If R2 refuses a pending zone, the deploy fails here and changes nothing else. Then the attach happens in Phase 4 instead, and the window is longer (see Downtime).
2. Ask organizers not to upload media for the next hour.
3. Run `copy` and then `verify` (the delta since Phase 1). Both must exit 0 before the move.
   - A key never changes: the upload Worker refuses a key that exists (409), and every key carries a new UUID. So the delta should only add objects.
   - A conflict means something wrote outside that path, or deleted a key and stored another object under it. The copy never overwrites, so it stops there.
   - Do not submit the move until it is resolved. Compare the two objects, delete the staged one in the allthings account's dashboard (R2 → allthings-media), and rerun `copy` and `verify`.
4. Warm the caches by loading every event, people and home page on staging, so the `/img` variants are in the Web Worker's edge cache. Vercel's image cache is warm from normal traffic.
5. Pick a time with no evening on the calendar within 24 hours.

**Phase 3: the move**

Erik submits the move in the personal account and accepts it in the allthings account. allthings.dev turns active in the allthings account, and media.allthings.dev now serves the new bucket. `dig +short NS allthings.dev` then answers max/rosalie.

**Phase 4: right after activation**

1. Run these checks:
   - `curl -sI https://media.allthings.dev/<a few keys>` must return 200 with a valid certificate.
   - `verify --public https://media.allthings.dev` must exit 0.
2. Re-home the apex/www redirect: [esthor/domains#232](https://github.com/esthor/domains/pull/232), steps 3–5 of its README section.
   - Deploy `wrangler.allthings.jsonc` and repeat its eight redirect checks.
   - Delete the personal-account Worker.
   - Move Terraform's state to the new zone (`state rm`, then the `--expect-import` plan, then apply).

   Until the deploy, allthings.dev and www don't answer: Worker custom domains need an active zone.

3. `bun run deploy --stage prod --profile allthings` (now "serve"), with `NEON_SYNC_URL` and `LUMA_API_KEY` passed as `infra/README.md` shows. This brings up:
   - the upload Worker in the allthings account (new URL and token), which runs its put/delete check
   - the sync Worker, its schedule still off
   - `MEDIA_UPLOAD_URL`, `MEDIA_UPLOAD_TOKEN` and `MEDIA_PUBLIC_URL` written to Vercel
4. **Redeploy production on Vercel.** Changed env only reaches new deployments. Until then, uploads still go to the old bucket.
5. Run `copy` again for anything uploaded to the old bucket before the redeploy, then `verify --public`.
6. Run an end-to-end check: one upload through the admin, visible on media.allthings.dev and as an `/img` variant.

**Phase 5: after**

- **The old bucket.** Keep the old bucket and every original untouched. The stack declares it `RemovalPolicy.retain()`, and the script never deletes. Decide later whether it is ever deleted. My suggestion is not before the 30-day transfer lock ends.
- **The old prod stack.** Never run `alchemy destroy --stage prod` with the default profile. Destroy plans nothing, so the account guard can't stop it, and it would remove the old upload Worker (harmless after Phase 4, but noisy).
- **Old upload Worker.** Leave it, or delete it by hand after the Vercel redeploy.
- **Tokens.** None to clean up: each copy run deleted its own. `cf accounts tokens list --profile allthings` shows any left by a run that crashed outright, named "allthings media copy <time>".
- **Docs.** README: the "default profile until the domain moves" sentence becomes past tense.

## Downtime: what can still go wrong

- **With a pre-attach and the ACM certificate:** none expected. The edge has the bucket and the certificate ready at activation.
- **With a pre-attach and no ACM:** media.allthings.dev may fail TLS until Universal SSL issues for the new zone, usually minutes. Most image traffic rides caches through that window:
  - the Worker's `/img` variants in `caches.default`
  - Vercel's optimized images
  - browser caches

  Direct links to originals, such as old link previews, would fail for those minutes.

- **If R2 won't pre-attach on a pending zone:** the window is attach time plus certificate time. The same caches soften it.

**There is no rollback for the zone once it moves.** The registration is transfer-locked for 30 days after the move. All de-risking therefore happens before the move:

- the copy is verified
- the domain is pre-attached
- Phase 4 is scripted

The source bucket stays intact, so any object can be re-copied at any time.

## Open questions and assumptions

1. **Whether R2 accepts a custom domain on a pending zone.** This is unverified. The stack tries it in Phase 2; failing is safe.
2. **When the zone activates.** That a Registrar move activates the new account's zone promptly is unverified. I'll watch the zone's status during Phase 3.
3. **Pre-existing drift.** `plan --stage prod` on main already shows `[MediaUpload] update` (an undeployed change on main). It's moot after Phase 4, which deploys a fresh upload Worker in the allthings account.
4. **Only the upload Worker writes media today** (the app and the reencode script both go through it). If anything else writes to the bucket, Phase 4's re-copy covers it, as long as it runs after that writer stops.
