# allthings for agents

Evenings for people who build software, in the neighborhoods of San Francisco, inside your coding agent.

The plugin gives an agent the allthings MCP server (`list_events`, `get_event`, `list_speakers`, `get_community`) and two skills, `find-evenings` and `evening-briefing`. In Claude Code it also brings a mod that takes over the interface with the allthings/\_ look, two themes and an output style.

| File                         | For                                                                                                   |
| ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| `plugin.json`, `mcp.json`    | The [Agent Plugins](https://agent-plugins.org) manifest and MCP config, read by every host            |
| `.claude-plugin/plugin.json` | Claude Code's manifest: the same plugin, its MCP server from `mcp.json`, and the mod's state contract |
| `skills/`                    | The two skills                                                                                        |
| `hooks/`, `types/`, `tests/` | The Claude Code mod and its tests                                                                     |
| `themes/`, `output-styles/`  | The allthings night and allthings paper themes, and the allthings output style                        |

## Try it in Claude Code

Mods need Claude Code 2.1.287 or later in the terminal (`claude --version`), or 2.1.286 in the Desktop app (`/status`). This plugin is tested with 2.1.293.

For one session, from a clone of this repository:

```bash
claude --plugin-dir plugins/allthings
```

To keep it, add this repository as a marketplace and install the plugin:

```bash
claude plugin marketplace add allthingsweb-dev/allthingsweb
claude plugin install allthings@allthings
```

or, at the Claude Code prompt, `/plugin marketplace add allthingsweb-dev/allthingsweb` and then `/plugin install allthings@allthings`. Run `/plugin` to see `allthings` among the active mods.

## What the mod does

- **Tool rows in the slash grammar.** Each tool call's row reads as a verb, a slash and what it acts on: `read/src/app.ts`, `edit/home.tsx`, `bash/bun test`, `search/"curation"`, `fetch/allthings.dev`, `agent/Find the venue table`, and `allthings/list_events` for an MCP tool. The slash is Bridge on light themes and Glow on dark ones. The status dot, the error color, `Interrupted` and the result under the row are Claude Code's own; whatever else Claude Code's row shows (a line range, a glob, an agent type) follows in dim. Rows inside an expanded group, which carry their output, and the Desktop app's rows, which expand and collapse themselves, stay as Claude Code draws them.
- **The spinner wanders the city.** While Claude works the spinner reads `allthings/_ shipping in SoMa…`, the cursor blinking, then `pairing in the Mission…`, `debugging in Dogpatch…`, `refactoring in the Tenderloin…`, `deploying from FiDi…`, through 36 real neighborhoods. Claude Code's elapsed time and tokens stay after it.
- **The next evening, above the prompt.** A slim Night band: the date, `allthings/<topic>_`, the neighborhood, the host, and an **I'm in →** button that opens the evening's Luma page. On the day it counts down (`tonight · in 2h 14m`); during the evening it says `live now`; once you've pressed the button it says `see you at/<topic>`. No evening ahead, or no network, and there is no band.
- **`/at`** prints the next evening's card: when, where, who's on stage, and where to say you're in. **`/at <slug>`** prints any evening's. **`/imin`** opens the next evening's Luma page. All three answer at once, with no Claude turn, even while Claude is working.

With `reduceMotion` on in `/config`, the cursors stay solid.

### Where the data comes from

The band and the commands call `list_events` (upcoming, limit 1) and `get_event` on the MCP server this plugin configures in `mcp.json`, (allthings.dev/mcp), so a change of URL there, such as a local server while developing, moves them too. The next evening is cached in the plugin's store and asked for again about every 30 minutes, or when it ends. When the site can't be reached the mod stays quiet: a cached evening shows for up to two hours, then the band goes. A headless run (`claude -p`, the SDK) asks the site only when a command does.

`claude plugin validate plugins/allthings` lists everything the mod reaches: the network (`$.http.fetch`, to the MCP URL alone), the plugin's own files (`$.fs.read`, for `mcp.json`), its store, `/config`'s theme and reduce-motion rows, the `COLORFGBG` variable, and `$.process.run` for `open`, `xdg-open` or `start` when you press **I'm in**.

## Themes and the output style

`/theme` lists **allthings night** and **allthings paper**. Claude Code colors its own interface and leaves the terminal's background alone, so set the terminal's background to Night (`#1B1729`) or Paper (`#F4F1EC`) to match. The themes take their colors from the brand tokens (`brand/all-things.tokens.json`), and a test in `brand/` holds them there.

The **allthings** output style keeps Claude Code's coding instructions and changes only the voice: plain and warm, lowercase where natural, neighborhoods by name, evenings rather than events, "I'm in" and never RSVP. It is opt-in: pick it with `/output-style allthings:allthings`, or under **Output style** in `/config`.

## Developing the mod

Claude Code writes the mod's type declarations into `.claude-plugin/types/` (gitignored) each time it loads the plugin from a folder, as with `--plugin-dir`. Then, from the repository root:

```bash
claude plugin validate --strict plugins/allthings
bunx --package typescript@5.9.3 tsc -p plugins/allthings
claude plugin test plugins/allthings
```

The tests run on Claude Code's own test kit, with no session, sign-in or network: every answer from the site is a fixture in `tests/fixtures.ts`. CI (`.github/workflows/plugin.yaml`) runs the three on every change to the plugin.

## Next

Hack mode, `/hack start` and `/hack submit` for hackathon evenings, is planned for v2 and isn't built yet.
