import { CodeBook } from "./codes.ts";
import { loadConfig } from "./config.ts";
import { createHue } from "./hue.ts";
import { AuditLog } from "./log.ts";
import { createFetch, Hub, maxRequestBodySize } from "./mcp.ts";
import { AddressLimiter } from "./policy.ts";

/**
 * The hub, run on the host's laptop:
 *
 *   bun src/main.ts                  serve /mcp on 127.0.0.1 for cloudflared
 *   bun src/main.ts --generate 150   print 150 new guest codes, once
 *   bun src/main.ts --zones          list the Bridge's rooms and zones
 *
 * See README.md for setup and the host runbook.
 */

const env = process.env;
const codesPath = env["AUX_CODES_FILE"] ?? "aux.codes.json";
const logPath = env["AUX_LOG_FILE"] ?? "aux.log.jsonl";

const usage = `Usage:
  bun src/main.ts                  serve the hub on 127.0.0.1
  bun src/main.ts --generate <n>   print n new guest codes (1-500), once
  bun src/main.ts --zones          list the Bridge's rooms and zones`;

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

async function serve(): Promise<void> {
  const config = loadConfig(env);
  const codes = CodeBook.load(codesPath);
  const hue = createHue({
    bridgeIp: config.bridge.ip,
    appKey: config.bridge.appKey,
  });
  const hub = new Hub({ config, hue, codes, log: new AuditLog(logPath) });
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

  const stop = () => {
    void server.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

const [command, argument] = process.argv.slice(2);
try {
  if (command === "--generate") generate(argument);
  else if (command === "--zones") await zones();
  else if (command === undefined) await serve();
  else {
    console.error(usage);
    process.exit(2);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
