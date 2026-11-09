import { loadPlaylist, prefetch } from "./catalog.ts";
import { CodeBook } from "./codes.ts";
import { loadConfig } from "./config.ts";
import { createHue } from "./hue.ts";
import { AuditLog } from "./log.ts";
import { createFetch, Hub, maxRequestBodySize } from "./mcp.ts";
import { Music } from "./music.ts";
import { AddressLimiter } from "./policy.ts";

/**
 * The hub, run on the host's laptop:
 *
 *   bun src/main.ts                  serve /mcp on 127.0.0.1 for cloudflared
 *   bun src/main.ts --generate 150   print 150 new guest codes, once
 *   bun src/main.ts --zones          list the Bridge's rooms and zones
 *   bun src/main.ts --prefetch       save the music set from mus.ax
 *
 * See README.md for setup and the host runbook.
 */

const env = process.env;
const codesPath = env["AUX_CODES_FILE"] ?? "aux.codes.json";
const logPath = env["AUX_LOG_FILE"] ?? "aux.log.jsonl";

const usage = `Usage:
  bun src/main.ts                  serve the hub on 127.0.0.1
  bun src/main.ts --generate <n>   print n new guest codes (1-500), once
  bun src/main.ts --zones          list the Bridge's rooms and zones
  bun src/main.ts --prefetch       save the config's music set from mus.ax`;

/** Prints that many new codes and saves their hashes. */
function generate(countArgument: string | undefined): void {
  const count = Number(countArgument);
  if (!Number.isInteger(count) || count < 1 || count > 500) {
    console.error(usage);
    process.exit(2);
  }
  const book = CodeBook.load(codesPath, { create: true });
  for (const code of book.generate(count)) console.log(code);
  console.error(
    `Saved the hashes of ${count} new codes to ${codesPath} (${book.size} in all). The codes above are not stored anywhere: print them now.`,
  );
}

/** Lists the Bridge's home, rooms and zones, and exits 1 if a config zone names one it lacks. */
async function zones(): Promise<void> {
  const config = loadConfig(env);
  const hue = createHue({
    bridgeIp: config.bridge.ip,
    appKey: config.bridge.appKey,
  });
  for (const group of await hue.groups()) {
    console.log(
      `${group.kind.padEnd(12)}${group.groupedLightId}  ${group.name}`,
    );
  }
  const ids = new Set(await hue.groupedLightIds());
  const missing = Object.entries(config.zones).filter(([, id]) => !ids.has(id));
  for (const [zone, id] of missing) {
    console.error(
      `Config zone "${zone}" names ${id}, which the Bridge doesn't have`,
    );
  }
  if (missing.length > 0) process.exit(1);
}

/** Saves the config's music set from mus.ax, and exits 1 if any track didn't arrive. */
async function prefetchMusic(): Promise<void> {
  const { music } = loadConfig(env);
  if (music === undefined) {
    throw new Error("The config has no music; add music.tracks first.");
  }
  const result = await prefetch({
    base: music.base,
    slugs: music.tracks,
    dir: music.cacheDir,
  });
  console.log(
    `Music in ${music.cacheDir}: ${result.saved.length} saved, ${result.kept.length} already there, ${result.failed.length} failed.`,
  );
  if (result.ignoredManifest !== undefined) {
    console.error(
      `Ignored the old manifest (${result.ignoredManifest}); every track was fetched again.`,
    );
  }
  for (const { slug, error } of result.failed) {
    console.error(`${slug}: ${error}`);
  }
  if (result.failed.length > 0) process.exit(1);
}

/**
 * Tonight's music from the prefetched set, or undefined when the config has
 * none or it can't play here. Music never stops the hub: the lights run
 * either way, and without music its tools stay out of tools/list.
 */
function loadMusic(config: ReturnType<typeof loadConfig>): Music | undefined {
  const { music } = config;
  if (music === undefined) return undefined;
  if (process.platform !== "darwin") {
    console.error(
      "Music off: the music plays through macOS's afplay; run the hub on a Mac, or remove music from the config.",
    );
    return undefined;
  }
  let playlist: ReturnType<typeof loadPlaylist>;
  try {
    playlist = loadPlaylist(music.cacheDir, music.tracks);
  } catch (error) {
    console.error(
      `Music off: ${error instanceof Error ? error.message : String(error)}; run bun src/main.ts --prefetch again.`,
    );
    return undefined;
  }
  const { tracks, missing } = playlist;
  if (tracks.length === 0) {
    console.error(
      `Music off: no music is saved in ${music.cacheDir}; run bun src/main.ts --prefetch first.`,
    );
    return undefined;
  }
  if (missing.length > 0) {
    console.error(
      `Music: ${missing.length} tracks aren't saved and won't play (${missing.join(", ")}); run --prefetch again.`,
    );
  }
  return new Music({ tracks, volume: music.volume });
}

/** Runs the hub's MCP server. */
async function serve(): Promise<void> {
  const config = loadConfig(env);
  const codes = CodeBook.load(codesPath);
  const hue = createHue({
    bridgeIp: config.bridge.ip,
    appKey: config.bridge.appKey,
  });
  const music = loadMusic(config);
  const hub = new Hub({
    config,
    hue,
    codes,
    log: new AuditLog(logPath),
    ...(music === undefined ? {} : { music }),
  });
  const handle = createFetch(
    hub,
    new AddressLimiter(config.addressLimitPerMinute),
  );

  const server = Bun.serve({
    // cloudflared runs on this machine; nothing else should reach the hub.
    hostname: "127.0.0.1",
    port: config.port,
    maxRequestBodySize,
    // A scene may wait on up to three Bridge calls of 4 s each.
    idleTimeout: 30,
    fetch: (request, bunServer) =>
      handle(request, bunServer.requestIP(request)?.address ?? "unknown"),
    /** Logs an unexpected error and answers 500 without detail. */
    error(error) {
      console.error(error);
      return Response.json({ error: "Internal error" }, { status: 500 });
    },
  });

  console.log(
    `aux hub on http://127.0.0.1:${server.port}/mcp: ${codes.size} codes, guests ${hub.policy.frozen ? "frozen until the host opens them" : "open"}, audit log ${logPath}`,
  );

  try {
    const ids = new Set(await hue.groupedLightIds());
    const missing = Object.entries(config.zones).filter(
      ([, id]) => !ids.has(id),
    );
    console.log(
      missing.length === 0
        ? "Bridge reached; every zone found."
        : `Bridge reached, but it lacks zones: ${missing.map(([zone]) => zone).join(", ")}`,
    );
  } catch (error) {
    console.error(
      `Bridge not reached yet (${error instanceof Error ? error.message : String(error)}); light changes will fail until it is.`,
    );
  }

  if (music !== undefined) {
    console.log(
      `Music: ${music.tracks.length} tracks ready, stopped until the host starts them with host_music.`,
    );
  }

  const stop = () => {
    void server.stop();
    void (music?.stop() ?? Promise.resolve()).then(() => process.exit(0));
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

const [command, argument] = process.argv.slice(2);
try {
  if (command === "--generate") generate(argument);
  else if (command === "--zones") await zones();
  else if (command === "--prefetch") await prefetchMusic();
  else if (command === undefined) await serve();
  else {
    console.error(usage);
    process.exit(2);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
