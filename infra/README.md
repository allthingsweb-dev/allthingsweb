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
- **Web Worker:** `web/` (the public API, the MCP server, the home page and `/brand`), on every stage but `prod`; previews run nothing else. Alchemy bundles it with web's dependencies and uploads `web/dist/public` as its static assets, so run `bun install` at the repository root and `bun run build` in `web/` before planning or deploying.
- **Images:** the Web Worker's `IMAGES` binding, on every stage but `prod`. It resizes and re-encodes the photos on `media.allthings.dev` into the variants the pages load (`/img/…`, see [`web/src/images/variants.ts`](../web/src/images/variants.ts)), and the Worker keeps each in the edge cache. It is a binding, not a resource: transformations are billed to the allthings account per unique transformation per month, the first 5,000 free. Past those, new variants fail and the Worker sends the originals instead.
- **Hyperdrive:** every stage but `prod`. The Web Worker's `HYPERDRIVE` binding, in front of production's Neon database as the read-only `site_reader` role, from `NEON_READER_URL` (see [Accounts and stages](#accounts-and-stages)).
- **Vercel env:** `prod` deploys write `MEDIA_UPLOAD_URL`, `MEDIA_UPLOAD_TOKEN` and `MEDIA_PUBLIC_URL` to every Vercel environment (the token is sensitive except in development, where Vercel doesn't allow it) with the Vercel CLI, so it needs to be signed in (`bunx vercel login`).

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

`prod` (media, the upload Worker and the Vercel env) follows the allthings.dev zone. Where the zone is active, prod serves: the bucket answers on `media.allthings.dev`, and the upload Worker and the Vercel env follow it. That is the `default` profile's account until the domain moves. In the allthings account before then, `bun run deploy --stage prod --profile allthings` only stages the bucket, with `media.allthings.dev` attached ahead of time once the zone is added there. Any other account is refused, so a deploy from an account the domain has left can't drop the upload Worker or the Vercel env.

## Moving media

[`scripts/copy-media.ts`](scripts/copy-media.ts) copies the bucket between accounts over R2's S3 API, so the allthings account's bucket holds every object before `media.allthings.dev` switches to it. It never overwrites or deletes: the source keeps every original, and a rerun copies only what the target still lacks.

Each copy is checked three times:

- The bytes read must hash to the source's ETag.
- R2 refuses the upload unless the bytes match the Content-MD5 sent with them.
- The ETag R2 stores must be that MD5.

`verify` reads every object from both buckets, and optionally from the public origin, and compares SHA-256s and headers. Credentials are R2 API tokens limited to one bucket each (read for the source, write for the target), passed through the environment and never printed. The file's header has the commands.

## CI credentials

GitHub Actions deploys with an account-owned token that has only the permissions listed in [`ci-token.json`](ci-token.json). [`scripts/ci-token.sh`](scripts/ci-token.sh) applies that file. It creates the token, or updates its policies in place, and writes the value straight into the repository's `CLOUDFLARE_API_TOKEN` secret, so nobody ever sees or copies it. When `alchemy.run.ts` declares more, widen `ci-token.json` in the same PR, then rerun the script after it merges.

The script runs on a maintainer's machine signed in to the allthings account with Cloudflare's CLI, whose sign-in may create account tokens, so no Global API Key or token-minting token exists anywhere. Run it from the repository root:

```sh
NODE_OPTIONS=--dns-result-order=ipv4first bunx cf@1.0.0-beta.12 auth create allthings --no-device   # once per machine
bash infra/scripts/ci-token.sh            # create, or update the policies
bash infra/scripts/ci-token.sh --rotate   # also roll the value and update the secret
```
