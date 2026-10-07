# allthings

all things from your terminal: what's coming up, who's on stage and how to get in. It reads the same public MCP server agents use, so what you see here is what they see.

```sh
curl -fsSL https://allthingsweb-dev.github.io/allthingsweb/install.bash | bash
```

That installs the latest stable release in `~/.allthings/bin`. `allthings` 2 is in prerelease until the launch, so ask for one by name:

```sh
curl -fsSL https://allthingsweb-dev.github.io/allthingsweb/install.bash | ALLTHINGS_VERSION=2.0.0-alpha.2 bash
```

It is also on npm as `allthings`, for Bun. Prereleases carry the `alpha` dist-tag:

```sh
bunx allthings@alpha events
```

## Use

```sh
allthings events                    # what's coming up
allthings events --past --limit 5   # the five most recent evenings
allthings event <slug>              # one evening: when, where, the talks
allthings speakers react            # who has been on stage about react
allthings rsvp <slug>               # open the evening's page to say you're in
allthings about                     # where to find everyone between evenings
```

Add `--json` to any of them for the public contract, unformatted, for scripts and agents. Exit codes are part of that contract: 0 ok, 1 service error, 2 usage error, 3 no such evening.

`ALLTHINGS_MCP_URL` points it at another server, such as a local Worker.

## The old name

This CLI used to be `atw`. The installer still puts an `atw` beside `allthings`, and the package still has an `atw` bin. Both run the same CLI and print a note on stderr, so scripts reading stdout keep working. The old name goes away in a later release. `ATW_MCP_URL` and `ATW_VERSION` are still read when the new names are unset.

## Working on it

```sh
bun install
bun run check && bun run typecheck && bun test
bun run src/index.ts events
```

`src/config.ts` holds the site it talks to, `siteOrigin`. It stays on allthingsweb.dev until allthings.dev serves the new site: until then allthings.dev only redirects, and a redirect drops an MCP POST. It flips with the domain move (`infra/docs/r2-migration.md`, Phase 4).

Releases are GitHub releases, cut by pushing an annotated tag that matches `version` in `package.json` (`.github/workflows/cli-release.yaml`). A hyphenated tag (`2.0.0-alpha.2`) is a prerelease, and the installer skips it unless asked.

The same workflow then publishes the package to npm with `bun publish`, after the binaries. `bun run build` (which packing runs) bundles `src/index.ts` and `src/atw.ts` for Bun into `dist/`, and the package ships only that, with zod inside. A prerelease gets the `alpha` dist-tag, a release `latest`. npm gives a package's first version `latest` whatever its tag, and `latest` can't be removed, so until there is a stable release `latest` follows the newest prerelease. The step then checks the registry's dist-tags. Publishing uses the `NPM_TOKEN` repository secret.
