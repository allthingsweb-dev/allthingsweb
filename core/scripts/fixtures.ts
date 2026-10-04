/**
 * Refreshes tests/fixtures from the live MCP server: every published event,
 * each event's details, every speaker and the community profile.
 *
 *   bun run fixtures [endpoint]
 */
const endpoint = process.argv[2] ?? "https://allthingsweb.dev/mcp";
const dir = new URL("../tests/fixtures/", import.meta.url);

async function call(name: string, args: Record<string, unknown>) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  const body = await response.text();
  const data = body
    .split("\n")
    .find((line) => line.startsWith("data: "))
    ?.slice("data: ".length);
  const message = JSON.parse(data ?? body);
  if (message.error || message.result?.isError) {
    throw new Error(
      `${name}: ${JSON.stringify(message.error ?? message.result)}`,
    );
  }
  return message.result.structuredContent;
}

async function write(file: string, value: unknown) {
  await Bun.write(new URL(file, dir), `${JSON.stringify(value, null, 2)}\n`);
}

const events = await call("list_events", { when: "all", limit: 100 });
const details = [];
for (const { slug } of events.events as Array<{ slug: string }>) {
  details.push(await call("get_event", { slug }));
}

await write("events.json", events);
await write("event-details.json", { events: details });
await write("speakers.json", await call("list_speakers", { limit: 200 }));
await write("community.json", await call("get_community", {}));
console.log(`fixtures: ${details.length} events from ${endpoint}`);
