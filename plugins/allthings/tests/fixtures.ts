/**
 * The world the mod's tests stand it in: a session in /work, the plugin's
 * MCP config, and the site's answers as recorded fixtures. No test reaches
 * the network: `http.fetch` is always one of these stubs.
 */

import type {
  HttpResponse,
  On,
  RenderInput,
  SessionStartInput,
} from "claude-code";
import { mock } from "claude-code/testing";

export const PLUGIN = "allthings";

export const SESSION: SessionStartInput = {
  surface: "terminal",
  isInteractive: true,
  cwd: "/work",
};

/** The plugin's mcp.json. */
export const MCP_JSON = JSON.stringify({
  $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
  mcpServers: {
    allthings: { type: "streamable-http", url: "https://allthings.dev/mcp" },
  },
});

/** An evening as list_events (an EventSummary) returns it. */
export const SUMMARY = {
  slug: "2026-10-15-all-things-agent-setups",
  name: "All Things Agent Setups",
  tagline: "See Luma for event details and registration.",
  url: "https://allthings.dev/2026-10-15-all-things-agent-setups",
  status: "upcoming",
  // 5:30–8:30pm PDT on Thursday, October 15.
  startsAt: "2026-10-16T00:30:00.000Z",
  endsAt: "2026-10-16T03:30:00.000Z",
  timeZone: "America/Los_Angeles",
  venue: {
    name: "Sentry",
    address: "Sentry, 45 Fremont St, San Francisco, CA 94105, USA",
  },
  rsvpUrl: "https://lu.ma/event/evt-agentsetups",
  recordingUrl: null,
  isHackathon: false,
} as const;

/** The same evening as get_event returns it. */
export const EVENT = {
  ...SUMMARY,
  talks: [
    {
      title: "My agent setup, file by file",
      description: "Plain text.",
      speakers: [
        {
          name: "Ada Lovelace",
          title: null,
          bio: null,
          links: { x: null, bluesky: null, linkedin: null },
        },
      ],
    },
  ],
  hosts: [{ name: "Sentry", about: "Application monitoring." }],
} as const;

/** Instants around the evening, as milliseconds. */
export const AT = {
  /** Tuesday, October 13, noon in San Francisco. */
  upcoming: Date.parse("2026-10-13T19:00:00.000Z"),
  /** Thursday, October 15, 1pm: the day of. */
  today: Date.parse("2026-10-15T20:00:00.000Z"),
  /** 6pm, half an hour in. */
  live: Date.parse("2026-10-16T01:00:00.000Z"),
  /** 9pm, after it ended. */
  past: Date.parse("2026-10-16T04:00:00.000Z"),
} as const;

/** A tool call's answer as the site's MCP server streams it. */
export function sse(result: unknown): HttpResponse {
  return {
    status: 200,
    ok: true,
    headers: { "content-type": "text/event-stream" },
    text: `event: message\ndata: ${JSON.stringify({ result, jsonrpc: "2.0", id: 1 })}\n\n`,
  };
}

export const structured = (value: unknown) => ({
  content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  structuredContent: value,
});

export const NOT_FOUND = {
  isError: true,
  content: [{ type: "text", text: 'No published event with slug "nope".' }],
};

/** What the site answers: the evenings ahead, and get_event's by slug. */
export type Site = {
  upcoming: readonly unknown[];
  events?: Readonly<Record<string, unknown>>;
  /** True: every request fails, as offline. */
  isDown?: boolean;
};

/**
 * Stands the mod in a session: settings, environment, store, clock, the
 * plugin's files and the site. Returns what the mod asked of the world.
 */
export function world(
  on: On,
  options: {
    site: Site;
    now: number;
    theme?: string;
    reduceMotion?: boolean;
    stored?: Record<string, unknown>;
    mcpJson?: string;
    surface?: "terminal" | "desktop";
    /** Whether the machine has a browser opener: macOS open, or none at all. */
    opener?: "mac" | "none";
    /** True: the store can be neither read nor written, as in a locked-down home. */
    isStoreDown?: boolean;
    /** Command names something else already took. */
    taken?: readonly string[];
  },
) {
  const requests: { url: string; tool: string; args: unknown }[] = [];
  const opened: string[][] = [];
  const toasts: string[] = [];
  const registered: string[] = [];
  const clock = mock.clock(on, { now: options.now });
  // The store, kept where the test can read what the mod saved.
  const stored = new Map<string, unknown>(Object.entries(options.stored ?? {}));
  const storeDown = { deny: "EPERM: operation not permitted" } as const;
  on("store.get", ($, e) =>
    options.isStoreDown === true ? storeDown : { value: stored.get(e.key) },
  );
  on("store.set", ($, e) => {
    if (options.isStoreDown === true) return storeDown;
    stored.set(e.key, e.value);
    return { value: undefined };
  });
  on("store.delete", ($, e) => {
    stored.delete(e.key);
    return { value: undefined };
  });
  on("store.keys", () => ({ value: [...stored.keys()] }));
  mock.env(on, {});
  on("session.start", () => ({ cwd: SESSION.cwd }));
  on("classic.SessionStart", () => ({}));
  on("command.register", ($, e) => {
    if (options.taken?.includes(e.name) === true) {
      return { deny: `"/${e.name}" refused: it is taken` };
    }
    registered.push(e.name);
    return { value: { command: e.name } };
  });
  on("config.list", () => ({
    value: [
      {
        key: "theme",
        label: "Theme",
        kind: "choice",
        value: options.theme ?? "dark",
        provider: { plugin: "engine", tier: "core" },
        isLocked: false,
      },
      {
        key: "reduceMotion",
        label: "Reduce motion",
        kind: "boolean",
        value: options.reduceMotion ?? false,
        provider: { plugin: "engine", tier: "core" },
        isLocked: false,
      },
    ],
  }));
  on("fs.read", ($, e) => {
    if (e.path.endsWith("/mcp.json") && !e.path.endsWith("/.mcp.json")) {
      return { value: options.mcpJson ?? MCP_JSON };
    }
    return { deny: `ENOENT: ${e.path}` };
  });
  on("http.fetch", ($, e) => {
    const body = JSON.parse(e.init?.body ?? "{}") as {
      params?: { name?: string; arguments?: { slug?: string } };
    };
    const tool = body.params?.name ?? "";
    requests.push({ url: e.url, tool, args: body.params?.arguments });
    if (options.site.isDown === true) return { deny: "getaddrinfo ENOTFOUND" };
    if (tool === "list_events")
      return { value: sse(structured({ events: options.site.upcoming })) };
    if (tool === "get_event") {
      const event = options.site.events?.[body.params?.arguments?.slug ?? ""];
      return {
        value: sse(event === undefined ? NOT_FOUND : structured(event)),
      };
    }
    return { value: { status: 404, ok: false, headers: {}, text: "" } };
  });
  on("process.run", ($, e) => {
    if (options.opener === "none")
      return { deny: `spawn ${e.argv[0] ?? ""} ENOENT` };
    opened.push([...e.argv]);
    const exitCode = e.argv[0] === "open" ? 0 : 1;
    return {
      value: {
        exitCode,
        stdout: "",
        stderr: "",
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    };
  });
  on("ui.toast", ($, e) => {
    toasts.push(e.text);
    return { value: undefined };
  });
  // What Claude Code draws where the mod passes: a site left as it was.
  on("ui.render", () => ({
    type: "Text",
    props: {},
    children: ["drawn by Claude Code"],
  }));
  return { requests, opened, toasts, registered, clock, stored };
}

/** The band above the prompt, 120 columns wide. */
export const BAND: Omit<RenderInput<"AbovePrompt">, "surface"> & {
  plugin: string;
} = {
  plugin: PLUGIN,
  component: "AbovePrompt",
  requestId: "above-prompt",
  viewport: { columns: 120, rows: 40 },
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 9 },
    view: {},
  },
};

/** A tool call's row, for a tool and its input. */
export function toolRow(
  tool: string,
  input: unknown,
  state: {
    isRunning?: boolean;
    isErrored?: boolean;
    isInterrupted?: boolean;
  } = {},
  surface: "terminal" | "desktop" = "terminal",
) {
  return {
    plugin: PLUGIN,
    surface,
    component: "ToolUse",
    requestId: "toolu_1",
    viewport: { columns: 120, rows: 40 },
    props: {
      tool_use_id: "toolu_1",
      tool,
      input,
      isRunning: state.isRunning ?? false,
      isErrored: state.isErrored ?? false,
      isInterrupted: state.isInterrupted ?? false,
    },
  } as const;
}

/** A drawing's text as it reads: strings, labels and sources, in order. */
export function textOf(tree: unknown): string {
  if (typeof tree === "string" || typeof tree === "number") return String(tree);
  if (Array.isArray(tree)) return tree.map(textOf).join("");
  if (typeof tree !== "object" || tree === null) return "";
  const props: unknown = Reflect.get(tree, "props");
  const label =
    typeof props === "object" && props !== null
      ? Reflect.get(props, "label")
      : undefined;
  return `${typeof label === "string" ? label : ""}${textOf(Reflect.get(tree, "children") ?? [])}`;
}

/** One element of a drawing, as plain data. */
export type Drawn = {
  type: string;
  props: Record<string, unknown>;
  children: unknown[];
};

/** Every element of a drawing, depth first. */
export function elementsOf(tree: unknown): Drawn[] {
  if (Array.isArray(tree)) return tree.flatMap(elementsOf);
  if (typeof tree !== "object" || tree === null) return [];
  const type: unknown = Reflect.get(tree, "type");
  const props: unknown = Reflect.get(tree, "props");
  const children: unknown = Reflect.get(tree, "children");
  const element: Drawn = {
    type: typeof type === "string" ? type : "",
    props:
      typeof props === "object" && props !== null
        ? (props as Record<string, unknown>)
        : {},
    children: Array.isArray(children) ? children : [],
  };
  return [element, ...elementsOf(element.children)];
}

/** A slash command as the person runs it from the prompt. */
export function typed(command: string, args = "") {
  return {
    command,
    args,
    origin: { kind: "composer" },
    presentation: { isFullscreen: false, columns: 120 },
  } as const;
}
