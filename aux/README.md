# aux

The pass-the-aux hub for an allthings evening. It runs on the host's laptop, controls the room's Philips Hue lights through the Hue Bridge, and serves an MCP endpoint that guests reach with `allthings aux …` (or any MCP client) and the code on their card. A safety policy sits between every guest and every light.

With `music` in the config, the hub also plays a curated set from [mus.ax](https://mus.ax), prefetched to disk and played through macOS's `afplay`, or `mpv` or PipeWire's `pw-play` on Linux. Guests queue tracks from the set and the aux holder may skip. Without `music`, the music tools stay out of `tools/list` and `now_playing` is `null`.

## Guest tools

Every call carries `Authorization: Bearer <code>`. Anyone may list the tools.

| Tool          | Arguments        | Result (`structuredContent`, and the same JSON as text)                                                                                                                                                                | Limit                  |
| ------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| `aux_status`  | `{}`             | `now_playing` (null), `holder` (`"you"`, `"someone"` or null), `queue_position` (0 holds the aux, null not in line), `queue_length`, `turn_ends_in_seconds`, `cooldown_seconds`, `frozen`, `scenes`, `colors`, `zones` | 1 per 5 s per code     |
| `set_scene`   | `{scene}`        | `scene`, `zones`, `transition_seconds`, `cooldown_seconds`                                                                                                                                                             | Light budget           |
| `set_color`   | `{color, zone?}` | `color`, `zone`, `transition_seconds`, `cooldown_seconds`                                                                                                                                                              | Light budget           |
| `request_aux` | `{}`             | `queue_position`, `queue_length`, `turn_ends_in_seconds`                                                                                                                                                               | None                   |
| `pass_aux`    | `{}`             | `holder`: `"someone"` when the next guest took it, null when nobody waited                                                                                                                                             | None                   |
| `list_tracks` | `{}`             | `tracks`: each `slug`, `title` and `duration_seconds`, in play order                                                                                                                                                   | None                   |
| `queue_track` | `{slug}`         | `queued`, `title`, `position` (1 plays next)                                                                                                                                                                           | Music budget           |
| `skip_track`  | `{}`             | `skipped`: the slug cut                                                                                                                                                                                                | Holder, once per 5 min |

The three music tools appear only when the hub has music. With music, `aux_status`'s `now_playing` is the playing track's `slug` and `title` (null between tracks or when stopped), and `up_next` lists the queued slugs. The music budget is one track waiting per code and two a night, with at most 8 in the queue. Only the guest holding the aux may skip, once every 5 minutes per code, so passing the aux and taking it back doesn't earn another skip. With nothing queued, the set plays in its configured order, round again.

The light budget is one scene or color change per code every 30 s, and 6 in any 10 minutes. While a code holds the aux, its cooldown is 10 s instead and the 10-minute cap doesn't apply. Turns are 5 minutes, first come first served. When a turn ends with nobody waiting, the aux is free for the next `request_aux`.

A refusal is a tool error (`isError: true`) whose `structuredContent`, repeated as JSON in its text, holds `code`, `message` and, for `rate_limited`, `retry_after_seconds`:

`rate_limited`, `frozen`, `unknown_scene`, `unknown_color`, `unknown_zone`, `not_holder`, `unauthorized`, `bridge_unavailable`, and with music `unknown_track`, `queue_full`, `already_queued`, `night_limit`, `skip_used` and `nothing_playing`.

This matches the `allthings aux` client in `cli/src/aux.ts`. A name lookup ignores case and surrounding spaces. An unknown name or a refusal costs the code nothing. An accepted change counts even when the Bridge then fails, because the light may have changed.

## Host tools

The host token from the config unlocks four more tools, five with music, listed only to it. It is never a guest code.

- `host_freeze {on}`: `true` makes every guest tool except `aux_status` answer `frozen`; `false` opens them. The hub starts frozen (`startFrozen`).
- `host_set_scene {scene}`: sets a scene even while frozen, with no per-code limit.
- `host_clear_queue {}`: empties the aux line and ends the current turn.
- `host_revoke_code {code_hash_prefix}`: revokes the code whose id starts with these 6 or more hex characters. The revocation is saved to the codes file, and the code's waiting track leaves the queue.
- `host_music {on}`, with music: `true` starts the set; `false` cuts the current track and stops. The music starts stopped.

The host may also call `queue_track`, limited only by the queue's 8, and `skip_track` at any time, frozen or not.

With the host token, `aux_status` also returns `host`: the holder's and the line's code ids, and the last 20 audit entries.

## Safety

`src/policy.ts` holds the rules, with no I/O. The Hue client checks every body it sends against them once more.

- **No flashing.** WCAG 2.3.1 (no more than three flashes in any second) is the house rule for room light. Every change fades over at least 1.5 s (`dynamics.duration`). The room gets at most one change every 3 s, from guests and host alike. Brightness stays within 25–80%. The hub never sends `alert`, `signaling`, an effect or Entertainment streaming, and the config refuses keys it doesn't know, so a scene can't carry one.
- **Scenes** set one to three zones (grouped lights), one group command each, so the Bridge sees about one group command a second at most.
- **Codes** are 10 characters of Crockford base32 (50 random bits). The codes file stores only their HMAC-SHA256 under a random salt. A code's id is the first 12 hex characters of its hash.
- **Audit log:** one JSON line per tool call in `aux.log.jsonl`, appended only. Guests appear by code id. Only names from the config are recorded, never what a guest typed.
- **HTTP guards:** request bodies over 16 KiB get 413. Each address may make 600 requests a minute (`addressLimitPerMinute`) before any code is read, and gets 429 with `Retry-After` past that. Guests on the venue's Wi-Fi may share one address, so this stops a runaway script, not a guest. Requests with an `Origin` header (browser pages) get 403. Bridge calls time out after 4 s.
- **Sound:** guests can't change the volume. `music.volume` (0 to 1) is the ceiling agreed with the venue; each player takes it in its own scale (`afplay -v 0.6`, `mpv --volume=60`, `pw-play --volume=0.6`). Only the configured set plays, from files saved before the night: no streaming and no uploads. A track that fails to play is out of the set for the night.
- **Network:** the hub listens on 127.0.0.1 only. It accepts only a private IPv4 address for the Bridge, because the Bridge's self-signed certificate is accepted unverified for that one address. `/healthz` answers only requests that didn't come through Cloudflare.

## Setup

Bun 1.3 or later, on the machine that joins the travel router's network, the same LAN as the Bridge: a Mac, or a Linux box such as a Raspberry Pi 5 (see [Running on a Raspberry Pi 5](#running-on-a-raspberry-pi-5)).

```sh
cd aux
bun install
cp aux.config.example.json aux.config.json   # gitignored
```

1. **Pair the Bridge.** Find its address in the Hue app (Settings → Bridges → ⓘ) or in the router's client list. Press the Bridge's link button. Within 30 s, run:

   ```sh
   curl -k -X POST "https://$BRIDGE_IP/api" \
     -H 'content-type: application/json' \
     -d '{"devicetype":"allthings_aux#hub","generatekey":true}'
   ```

   The answer's `success.username` is the application key. Put it in `bridge.appKey` and the address in `bridge.ip`, or set `AUX_HUE_APP_KEY` and `AUX_BRIDGE_IP` instead.

2. **Set the host token:** `openssl rand -hex 24` into `hostToken`, or `AUX_HOST_TOKEN`.

3. **Name the zones.** Make the rooms and zones in the Hue app. Then `bun src/main.ts --zones` lists the home, rooms and zones with their `grouped_light` ids. Put the ids in `zones`, and set `defaultZone` (where `set_color` goes without a zone). The command exits 1 if a configured id is missing from the Bridge.

4. **Scenes and palette.** Palette colors are CIE `xy` or a white as `mirek` (153–500), with an optional `brightness`. Each scene maps one to three zones to a palette color and a brightness from 25 to 80. Check every scene by eye at the rehearsal.

5. **Codes.** `bun src/main.ts --generate 150` prints 150 codes once, to stdout, and adds their hashes to `aux.codes.json`. Send the codes straight to card printing. They are not stored anywhere, so don't save them in the repository or anywhere near it. Generating codes while the hub runs is safe, since the hub and `--generate` take turns on the file. The hub starts accepting the new codes when it next reads the file: at its next start, or the next time the host revokes a code with `host_revoke_code`.

6. **Music** (optional). List the set's mus.ax slugs in `music.tracks`, in the order they should play, and set `music.volume`. Only tracks whose rights you hold belong in the set. `bun src/main.ts --prefetch` reads mus.ax's public catalog, saves each track as `aux.music/<slug>.mp3` (`music.cacheDir`, gitignored) with a `tracks.json` manifest of sizes and SHA-256s, keeps files it already saved, and exits 1 if any track didn't arrive. The hub plays only saved tracks at their recorded size and says at start which are missing. The hub plays through `afplay` on macOS and `mpv`, else `pw-play`, on Linux; `music.player` names one instead. If none are saved, or no player is installed, it says why and starts without music: the lights run, and the music tools stay out of `tools/list`.

`AUX_CONFIG`, `AUX_PORT`, `AUX_CODES_FILE` and `AUX_LOG_FILE` move the config, the port (8787), the codes file and the log.

## Running on a Raspberry Pi 5

The hub, the Bridge's HTTP API and `cloudflared` don't depend on macOS, so a Raspberry Pi 5 on 64-bit Raspberry Pi OS runs the night, and a Mac with the same checkout stands by as the backup.

1. **Install.** Bun ships a Linux arm64 build (`curl -fsSL https://bun.sh/install | bash`). Install `mpv` for the music (`sudo apt install mpv`). Install `cloudflared` from Cloudflare's arm64 package.
2. **Sound.** The Pi 5 has no headphone jack, so play through HDMI, a USB audio adapter or a USB speaker. Pick the output with `wpctl status` and `wpctl set-default <id>`, then test it with `mpv --no-video <a saved track>` at the agreed volume.
3. **Same files on both machines.** Copy `aux.config.json`, `aux.codes.json` and the tunnel's credentials JSON to the Pi and the Mac, and run `bun src/main.ts --prefetch` on each. The Bridge's application key works from any machine on its LAN.
4. **Run.** Start the hub and the tunnel as below, in two terminals or as two systemd services that start after the network is up.

**Only one hub at a time.** A Cloudflare Tunnel takes several connectors and spreads requests across them, so a second machine running `cloudflared tunnel run allthings-aux` would split guests between two hubs with separate lines. Stop the hub and the tunnel on one machine before starting them on the other. Switching starts the backup frozen with an empty line, as any restart does (see Restarts).

## Running behind cloudflared at aux.allthings.dev

Guests reach the hub through a named Cloudflare Tunnel. It only connects outward, so no inbound port opens. Creating the tunnel and its DNS record needs an account with access to the `allthings.dev` zone:

```sh
cloudflared tunnel login
cloudflared tunnel create allthings-aux
cloudflared tunnel route dns allthings-aux aux.allthings.dev
```

`~/.cloudflared/config.yml` exposes `/mcp` alone:

```yaml
tunnel: <tunnel id>
credentials-file: <path to the tunnel's credentials json>
ingress:
  - hostname: aux.allthings.dev
    path: ^/mcp$
    service: http://127.0.0.1:8787
  - service: http_status:404
```

Then, in two terminals:

```sh
bun src/main.ts                      # aux hub on http://127.0.0.1:8787/mcp
cloudflared tunnel run allthings-aux
```

Behind another tunnel, such as Tailscale Funnel, requests carry no `cf-connecting-ip`, so every guest counts as one address for the address limit, and `/healthz` is reachable from outside.

## Host runbook

A shell helper for the host tools, on the hub laptop:

```sh
host() {
  curl -s http://127.0.0.1:8787/mcp \
    -H "authorization: Bearer $AUX_HOST_TOKEN" \
    -H 'content-type: application/json' \
    -H 'accept: application/json, text/event-stream' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"$1\",\"arguments\":${2:-"{}"}}}"
}
```

**Before doors**

1. Start the hub, then the tunnel. The hub prints `Bridge reached; every zone found.` If it doesn't, check the Bridge's address and key with `bun src/main.ts --zones`.
2. `curl -s http://127.0.0.1:8787/healthz` shows `frozen`, the number of codes and the Bridge's last success and error.
3. From a phone on cellular, run `allthings aux status`.
4. Set the room: `host host_set_scene '{"scene":"house"}'`. Guests stay frozen.
5. With music: the hub loads the saved tracks when it starts, so run `bun src/main.ts --prefetch` before step 1, at 12:30 PM on the day while the venue's network is up; if you prefetch after the hub is running, restart it. Check the hub's start line names no missing tracks, then test the speaker at the agreed volume with `host host_music '{"on":true}'`, then `'{"on":false}'`.

**Doors:** `host host_freeze '{"on":false}'`, and with music `host host_music '{"on":true}'`.

**During the night**

- `host aux_status` shows the holder, the line and the last 20 actions. `tail -f aux.log.jsonl` shows everything.
- To revoke a guest's code, take its code id from either and run `host host_revoke_code '{"code_hash_prefix":"<first 8 characters>"}'`.
- To reset the line, run `host host_clear_queue`.
- To cut a track, run `host skip_track`. To stop the music, `host host_music '{"on":false}'`.

**Kill ladder, fastest first**

1. `host host_freeze '{"on":true}'`: guest tools refuse at once.
2. Stop `cloudflared` (Ctrl-C): nothing outside reaches the hub.
3. The Hue dimmer or the Hue app recalls the house scene with no laptop involved.

**Fallback.** If anything fails (the hub, the Bridge in `/healthz`, the tunnel), stop `cloudflared` and the hub. The host then runs the night's scenes from the Hue app and the dimmer, and guests' `allthings aux` says it can't reach the hub.

**Restarts.** The line, cooldowns, freeze and music queue live in memory, so a restart starts frozen with an empty line, the music stopped and per-code track counts fresh. Codes and revocations are kept in `aux.codes.json`.

## Working on it

```sh
bun install
bun run check && bun run typecheck && bun test
```

The tests drive the policy on a fake clock, the Hue client and the mus.ax prefetch with a fake `fetch`, and the player with fake processes in place of `afplay`, `mpv` and `pw-play`, whose command lines and choice are tested on their own. The endpoint tests call it as the CLI does. Nothing here has run against a real Bridge yet: the soak and the rehearsal do that.
