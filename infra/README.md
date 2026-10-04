# infra

Cloudflare resources for allthings, declared with [Alchemy](https://alchemy.run) v2 in [`alchemy.run.ts`](alchemy.run.ts). Deploy state lives in Cloudflare (`Cloudflare.state()`), so every machine and CI see the same resources.

From `infra/`, sign in to Cloudflare once per machine (browser OAuth), then plan and deploy:

```sh
bun alchemy profile edit --add Cloudflare
bun run plan --stage prod     # preview changes to production
bun run deploy --stage prod   # apply them
bun run deploy --profile allthings   # your own stage (live_$USER), Web Worker only
```

- **Media:** `prod` only. An R2 bucket served on `media.allthings.dev`, kept even if removed from the stack.
- **Upload Worker:** `prod` only. Stores and deletes media for the app while it runs on Vercel. The bucket is a binding and callers present a token Alchemy generates. Every deploy proves uploads work by storing and deleting one object.
- **Web Worker:** `web/` (the public API, the MCP server, the home page and `/brand`), on every stage but `prod` until its Hyperdrive binding lands; previews run nothing else. Alchemy bundles it with web's dependencies and uploads `web/dist/public` as its static assets, so run `bun install` at the repository root and `bun run build` in `web/` before planning or deploying.
- **Vercel env:** `prod` deploys write `MEDIA_UPLOAD_URL`, `MEDIA_UPLOAD_TOKEN` and `MEDIA_PUBLIC_URL` to every Vercel environment (the token is sensitive except in development, where Vercel doesn't allow it) with the Vercel CLI, so it needs to be signed in (`bunx vercel login`).

## Accounts and stages

allthings has its own Cloudflare account (`af627f300cd00c4dca56aacf05bea050`), so a deploy credential can only touch allthings resources. Every stage but `prod` deploys there and runs only the Web Worker:

- **`pr-<number>`:** one per pull request, deployed by [`deploy.yaml`](../.github/workflows/deploy.yaml) on every push and destroyed when the PR closes. Its URL is in the PR's deployment and the run summary.
- **`staging`:** main, deployed on every merge.
- **Your own stage:** `bun run deploy --profile allthings` from a machine signed in with `bun alchemy profile edit --profile allthings --add Cloudflare`.

`prod` (media, the upload Worker and the Vercel env) still lives in the account that holds the allthings.dev domain, and a maintainer deploys it with the `default` profile until the domain moves to the allthings account.

## CI credentials

GitHub Actions deploys with an account-owned token that has only the permissions listed in [`ci-token.json`](ci-token.json). [`scripts/ci-token.sh`](scripts/ci-token.sh) applies that file. It creates the token, or updates its policies in place, and writes the value straight into the repository's `CLOUDFLARE_API_TOKEN` secret, so nobody ever sees or copies it. When `alchemy.run.ts` declares more, widen `ci-token.json` in the same PR, then rerun the script after it merges.

The script runs on a maintainer's machine signed in to the allthings account with Cloudflare's CLI, whose sign-in may create account tokens, so no Global API Key or token-minting token exists anywhere. Run it from the repository root:

```sh
NODE_OPTIONS=--dns-result-order=ipv4first bunx cf@1.0.0-beta.12 auth create allthings --no-device   # once per machine
bash infra/scripts/ci-token.sh            # create, or update the policies
bash infra/scripts/ci-token.sh --rotate   # also roll the value and update the secret
```
