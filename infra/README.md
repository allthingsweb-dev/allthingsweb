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
- **Web Worker:** `web/` (the public API and MCP server), on every stage but `prod` until its Hyperdrive binding lands. Alchemy bundles it with web's dependencies, so run `bun install` at the repository root before planning or deploying.
- **Vercel env:** `prod` deploys write `MEDIA_UPLOAD_URL`, `MEDIA_UPLOAD_TOKEN` and `MEDIA_PUBLIC_URL` to every Vercel environment (the token is sensitive except in development, where Vercel doesn't allow it) with the Vercel CLI, so it needs to be signed in (`bunx vercel login`).
