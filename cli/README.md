# allthings

allthings from your terminal: what's coming up, who's on stage and how to get in. It reads the same public MCP server agents use, so what you see here is what they see.

```sh
curl -fsSL https://allthings.dev/install.bash | bash
```

That installs the latest stable release, `allthings` 2, in `~/.allthings/bin`.

It is also on npm as `allthings`, for Bun:

```sh
bunx allthings
```

## Use

```sh
allthings                           # the next evening, and what to run from there
allthings events                    # what's coming up
allthings events --past --limit 5   # the five most recent evenings
allthings event next                # the next evening: when, where, the talks
allthings event latest              # the last one, with its video when there is one
allthings speakers react            # who has been on stage about react
allthings rsvp next                 # open the next evening's page to say you're in
allthings open latest               # open the last evening's page on allthings.dev
allthings guide                     # conferences worth the trip, starred as Michelin stars restaurants
allthings about                     # where to find everyone between evenings
allthings coach slides.md talk.vtt  # coaching for your talk, before you give it
```

`event`, `rsvp` and `open` take an evening's slug, from `events`, or `next` and `latest`, so every line above runs as typed. With nothing on the calendar, `allthings` shows the last evening and where the next one is announced first, and `event next` exits 3.

Add `--json` to any of them except `rsvp` and `open`, which print just the link, for the public contract, unformatted, for scripts and agents. On its own, `allthings --json` gives `{ next, latest }`, each an evening or `null`. Exit codes are part of that contract: 0 ok, 1 service error, 2 usage error, 3 no such evening.

`ALLTHINGS_MCP_URL` points it at another server, such as a local Worker.

## Coach your talk

```sh
allthings coach slides.md rehearsal.vtt                      # a 3-minute open-floor slot
allthings coach outline.md --slot 20 --goal teach-a-technique
allthings coach rehearsal.txt --goal first-talk --json
```

`coach` sends your talk to `coach_talk`, the MCP server's coaching, and prints what to change first, then each finding (must, should, consider) with what it measured and what to do, what already works, and what it couldn't check without more. Every check is explained at [allthings.dev/coach](https://allthings.dev/coach).

A file's extension says what it is: `.md` is an outline, or slides split by lines of `---`, and its first heading is the title unless `--title` gives one; `.txt`, `.vtt` and `.srt` are a rehearsal's transcript, and with timestamps (`.vtt`, `.srt`) it also checks your pace. Send at most one of each. `--slot` is the slot in minutes: 3, an open floor's, unless given, or 20 with `--talk`, and a slot over 5 minutes is a talk in the lineup. `--goal` says what you want from the talk, as often as you like: `first-talk`, `teach-a-technique`, `find-contributors`, `show-a-launch` or `get-hired`. `--abstract` adds the abstract.

The files are read only to send them; `coach_talk` keeps none of what it is sent. A file it can't read, one too long for `coach_talk`, or an unknown goal exits 2 before anything is sent.

## Agents

```sh
allthings mcp                       # a line to add allthings to Claude Code, Codex, VS Code or Cursor
```

It prints the server's URL, its tools and a line for each agent, for example `claude mcp add --transport http allthings https://allthings.dev/mcp`. It reads nothing, so it works offline. With `ALLTHINGS_MCP_URL` set, the lines name that server instead. `allthings mcp --json` gives `{ name, url, transport, tools }`. An agent with a shell can also just run this CLI with `--json`.

## aux

At an evening that passes the aux, guests set the room's lights from their terminal, with the code on the card from the check-in table:

```sh
allthings aux login <code>           # save the code from your card
allthings aux status                 # who has the aux, your place in line, your cooldown
allthings aux scenes                 # tonight's scenes
allthings aux scene ocean            # set the room to one of them
allthings aux color mint             # set a color, everywhere or on one --zone
allthings aux request                # get in line for the aux
allthings aux pass                   # hand it to the next person
allthings aux tracks                 # tonight's tracks, when music is on
allthings aux queue <slug>           # queue one
allthings aux skip                   # skip the track playing, if you hold the aux
```

`login` saves the code in `~/.allthings/aux-code` (`$ALLTHINGS_HOME/aux-code` when the installer's `ALLTHINGS_HOME` is set), readable by you alone. No command prints the code, even when the hub sends it back. `ALLTHINGS_AUX_CODE` wins over the saved code.

The hub is an MCP server at `https://aux.allthings.dev/mcp`, and `ALLTHINGS_AUX_URL` points at another, such as one on `localhost`. Every call sends the code as `Authorization: Bearer <code>`, so agents can use the same endpoint and code. Its tools are `aux_status`, `set_scene`, `set_color`, `request_aux` and `pass_aux`, plus `list_tracks`, `queue_track` and `skip_track` when music is on. The music commands check `tools/list` first and say "Music isn't on tonight" when they're missing.

When the hub refuses, the CLI says why from the tool error's `code`: going too fast (`rate_limited`, with the seconds to wait from `retry_after_seconds`, or from `Retry-After` on an HTTP 429), guest control paused by the host (`frozen`), a scene or color tonight doesn't have (`unknown_scene`, `unknown_color`), something only the aux holder can do (`not_holder`), or a code the hub doesn't accept (`unauthorized`, or an HTTP 401). Exit codes: 1 when the hub refused or couldn't be reached, 2 for an unknown scene or color, a missing code and other usage errors.

`status` reads `holder`, `queue_position`, `cooldown_seconds`, `frozen`, `scenes` and `colors` (or their camelCase names) from `aux_status`, and prints the hub's own text when its result has another shape. `--json` prints what the hub returned.

## The old name

This CLI used to be `atw`. The installer still puts an `atw` beside `allthings`, and the package still has an `atw` bin. Both run the same CLI and print a note on stderr, so scripts reading stdout keep working. The old name goes away in a later release. `ATW_MCP_URL` and `ATW_VERSION` are still read when the new names are unset.

## Working on it

```sh
bun install
bun run check && bun run typecheck && bun test
bun run src/index.ts events
```

`src/config.ts` holds the site it talks to, `siteOrigin`: https://allthings.dev, whose MCP server is at `/mcp`.

Releases are GitHub releases, cut by pushing an annotated tag that matches `version` in `package.json` (`.github/workflows/cli-release.yaml`). A hyphenated tag (`2.0.0-alpha.2`) is a prerelease, and the installer skips it unless asked.

The same workflow then publishes the package to npm with `bun publish`, after the binaries. `bun run build` (which packing runs) bundles `src/index.ts` and `src/atw.ts` for Bun into `dist/`, and the package ships only that, with zod inside. A prerelease gets the `alpha` dist-tag, a release `latest`. npm gives a package's first version `latest` whatever its tag, and `latest` can't be removed, so until there is a stable release `latest` follows the newest prerelease. The step then checks the registry's dist-tags. It publishes with `--tolerate-republish`, so rerunning it after a publish that went through repairs and checks the dist-tags instead of failing on the existing version. It authenticates with npm trusted publishing: the job trades GitHub's OIDC token at npm's exchange for a short-lived token that can publish `allthings`, so no long-lived npm token is stored anywhere. npm accepts the trade only from this workflow, set as the trusted publisher in the package's settings.

Publishing to npm waits for a person. The npm job runs in the `npm-release` environment, which needs Erik's approval in GitHub (admins can't bypass it) and accepts only version tags, and npm's trusted publisher names that environment. The job also stops unless the tagged commit is on `main`. So having write access to the repository isn't enough to publish the CLI.
