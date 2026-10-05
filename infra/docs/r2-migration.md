# Moving media to the allthings account

Status: prepared, nothing run. Blocked on Erik enabling R2 in the allthings account (`af627f300cd00c4dca56aacf05bea050`).

## The one thing to know

**The cutover isn't a step after the domain move. The move itself is the cutover.**

- An R2 custom domain only works in the zone's own account. Cloudflare's docs say the domain "must have been added as a zone in the same account as the R2 bucket".
- When allthings.dev turns active in the allthings account, the old zone is marked Moved Away. Cloudflare's edge then routes media.allthings.dev by the new zone's config.
- From that moment, the old bucket's custom domain no longer serves anything.

So for zero downtime, the new bucket must be **full, verified, and already attached to media.allthings.dev before the move happens**. If R2 is still off on Oct 11, the move takes media offline. The image rows store absolute `https://media.allthings.dev/...` URLs, so there is no host to fall back to.

Critical path: Erik enables R2 → at least one day of copying and verifying → the domain move (earliest Oct 11). That date is the registrar's 10-day rule; the domain was registered Sep 30.

## What this change adds

- **[`src/media.ts`](../src/media.ts): prod follows the zone.** `productionRole(accountId, zone)` decides:
  - **serve:** allthings.dev is active in the deploying account. This is today's prod: the bucket on the domain, the upload Worker, and the Vercel env. `alchemy plan --stage prod` in the current account shows `[Media] noop`, so nothing changes there.
  - **stage:** the allthings account before the move. Only the bucket `allthings-media` is declared. Once the zone has been added there (pending), media.allthings.dev is attached ahead of time, so it serves from the instant the zone turns active.
  - **refused:** any other account, for example the personal one after the domain has left. Without this, a stray deploy from there would drop the upload Worker and the Vercel env.
  - I checked this with a real plan: `plan --stage prod --profile allthings` reaches the bucket and stops at "Please enable R2". That is the gate.
- **[`scripts/copy-media.ts`](../scripts/copy-media.ts) and [`src/media-copy.ts`](../src/media-copy.ts): the copy**, over R2's S3 API (`aws4fetch`). Commands are `plan`, `copy [--record file]` and `verify [--public https://media.allthings.dev]`.
  - **It never overwrites anything.** Every PUT is `If-None-Match: *`. A different object at an existing key is reported as a conflict, never replaced.
  - **It never deletes anything.** The source is only ever read.
  - **Resumable.** A rerun lists both buckets and copies only what's missing. A key that was stored after the listing was taken gets compared, not rewritten.
  - **Checksums.** The bytes read must hash to the source's ETag. R2 refuses the PUT unless they match the `Content-MD5` header. The ETag R2 returns must be that MD5.
  - **Verify.** `verify` re-reads every object from both buckets and compares size, SHA-256 and headers. With `--public` it also checks the bytes visitors actually get.
  - **What's kept.** Content-Type, Cache-Control, Content-Disposition, Content-Encoding, Content-Language, Expires and `x-amz-meta-*`.
  - **Bounded.** Concurrency is bounded (`--concurrency`, default 8). The exit code is non-zero on any conflict or failure. `--record` appends key, size, MD5 and SHA-256 as JSON lines, as an audit trail.
- **Checks.**
  - 22 infra tests pass. They cover the plan, copying, a rerun as a no-op, conflicts left alone, a corrupt read never written, header preservation, the XML listing parse and the pool.
  - Typecheck, prettier and oxlint pass.
- **Considered and not used.**
  - Sippy: it only takes S3 or GCS as a source.
  - Super Slurper: it supports R2→R2 and Alchemy has `Cloudflare.R2.SuperSlurperJob`, but it needs the same two tokens. It also gives no per-object proof we can audit, and has no conditional write. It stays a fallback.

## Erik-only steps (batched)

1. **R2.** In the allthings account's dashboard, click "enable R2" (Workers Free includes 10 GB).
2. **Source token** (personal account). R2 → Manage API tokens → Create Account API token:
   - "Object Read only", limited to bucket `allthings-media`, TTL 14 days.
   - Store it in 1Password as an API Credential named `allthings media source`, with the Access Key ID as `username` and the Secret Access Key as `credential`.
3. **Target token** (allthings account, after Phase 1 has created the bucket). Same steps:
   - "Object Read & Write", limited to `allthings-media`, TTL 14 days.
   - Store it as `allthings media target`.
4. **Zone in the allthings account** (needed for the registrar move anyway). Add allthings.dev as a website on the Free plan, and turn DNSSEC off on the current zone.
   - Export the current zone's DNS records and import the ones that aren't media into the new zone (email routing and anything else esthor/domains manages).
   - media.allthings.dev's record is created by R2 when the domain is attached. Don't import it.
5. **The move.** Submit it from the personal account (Manage Domain → Configuration), then accept it in the allthings account within 5 days.
6. **Optional, your call:** an Advanced Certificate (ACM, about $10/month, cancel after) ordered on the pending zone.
   - Per Cloudflare's docs, it deploys the moment the zone turns active. That removes the remaining TLS gap (see Downtime).
   - It's a cost and taste call, so I haven't decided it.

## Runbook

Run from `infra/` once this has merged. Credentials only via `op read`, never echoed. `SOURCE_ACCOUNT_ID` is the default profile's account; read just that field with `jq -r .values.accountId ~/.alchemy/profiles/default/cloudflare.json`.

**Phase 1: as soon as R2 is on (well before Oct 11)**

1. `bun run deploy --stage prod --profile allthings`. This stages the bucket only. The output says the domain isn't attached until the zone is added.
2. Erik step 3 (the target token).
3. `bun scripts/copy-media.ts plan`. This gives the inventory (counts, MB), and conflicts must be 0. The bucket's size isn't known until this first run.
4. `bun scripts/copy-media.ts copy --record ../media-copy-1.jsonl`, then `verify`. Both must exit 0.

**Phase 2: the day of the move, before submitting it**

1. Erik step 4 (zone added, pending; DNSSEC off; records imported).
2. `bun run deploy --stage prod --profile allthings` again. This attaches media.allthings.dev to the new bucket on the pending zone.
   - Check in the dashboard that the bucket's custom domain shows media.allthings.dev.
   - If R2 refuses a pending zone, the deploy fails here and changes nothing else. Then the attach happens in Phase 4 instead, and the window is longer (see Downtime).
3. Ask organizers not to upload media for the next hour.
4. Run `copy` and then `verify` (the delta since Phase 1).
5. Warm the caches by loading every event, people and home page on staging, so the `/img` variants are in the Web Worker's edge cache. Vercel's image cache is warm from normal traffic.
6. Pick a time with no evening on the calendar within 24 hours.

**Phase 3: the move**

Erik submits the move in the personal account and accepts it in the allthings account. allthings.dev turns active in the allthings account, and media.allthings.dev now serves the new bucket.

**Phase 4: right after activation**

1. Run these checks:
   - `curl -sI https://media.allthings.dev/<a few keys>` must return 200 with a valid certificate.
   - `verify --public https://media.allthings.dev` must exit 0.
2. `bun run deploy --stage prod --profile allthings` (now "serve"). This brings up the upload Worker in the allthings account (new URL and token), runs its put/delete check and writes `MEDIA_UPLOAD_URL`/`MEDIA_UPLOAD_TOKEN`/`MEDIA_PUBLIC_URL` to Vercel.
3. **Redeploy production on Vercel.** Changed env only reaches new deployments. Until then, uploads still go to the old bucket.
4. Run `copy` again for anything uploaded to the old bucket before the redeploy, then `verify --public`.
5. Run an end-to-end check: one upload through the admin, visible on media.allthings.dev and as an `/img` variant.

**Phase 5: after**

- **The old bucket.** Keep the old bucket and every original untouched. The stack declares it `RemovalPolicy.retain()`, and the script never deletes. Decide later whether it is ever deleted. My suggestion is not before the 30-day transfer lock ends.
- **The old prod stack.** Never run `alchemy destroy --stage prod` with the default profile. Destroy plans nothing, so the account guard can't stop it, and it would remove the old upload Worker (harmless after Phase 4, but noisy).
- **Old upload Worker.** Leave it, or delete it by hand after the Vercel redeploy.
- **Tokens.** Revoke both R2 tokens and delete the 1Password items.
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
