# infra

Cloudflare resources for allthings, declared with [Alchemy](https://alchemy.run) v2 in [`alchemy.run.ts`](alchemy.run.ts). Deploy state lives in Cloudflare (`Cloudflare.state()`), so every machine and CI see the same resources.

From `infra/`, sign in to Cloudflare once per machine (browser OAuth), then plan and deploy:

```sh
bun alchemy profile edit --add Cloudflare
bun run plan --stage prod     # preview changes to production
bun run deploy --stage prod   # apply them
bun run deploy                # your own stage (live_$USER) with its own resources
```

- **Media:** an R2 bucket. Only `prod` gets the `media.allthings.dev` domain, and its bucket is kept even if removed from the stack.
- **Upload Worker:** stores and deletes media for the app while it runs on Vercel. The bucket is a binding and callers present a token Alchemy generates. Every deploy proves uploads work by storing and deleting one object.
- **Vercel env:** `prod` deploys write `MEDIA_UPLOAD_URL`, `MEDIA_UPLOAD_TOKEN` and `MEDIA_PUBLIC_URL` to every Vercel environment (the token is sensitive except in development, where Vercel doesn't allow it) with the Vercel CLI, so it needs to be signed in (`bunx vercel login`).

## CI credentials

[`stacks/github.ts`](stacks/github.ts) mints the account-owned Cloudflare token GitHub Actions deploys with, and writes it and the account ID to the repository's `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets. Its policies grant only what `alchemy.run.ts` declares. Widen them there, in the same PR that declares more.

Minting tokens takes the account's Global API Key, which OAuth can't provide. A maintainer deploys this stack by hand with a separate `admin` profile whose key comes from 1Password. Remove the key from the profile right after:

```sh
op read "op://Private/Cloudflare Global API Key/credential" | bun alchemy profile edit --profile admin \
  --add cloudflare --method stored --set apiKey=- \
  --set email="$(op read 'op://Private/Cloudflare Global API Key/username')" \
  --set accountId=1b90995af2e8ed1710a8058226838681
gh auth token | bun alchemy profile edit --profile admin --add github --method stored --set token=-
bun alchemy deploy --config stacks/github.ts --stage prod --profile admin
bun alchemy profile edit --profile admin --remove cloudflare --remove github
```

Rerun it to rotate the token or change its policies.
