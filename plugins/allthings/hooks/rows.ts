/**
 * A tool call's row in the slash grammar: a lowercase verb, a slash, then
 * what it acts on (read/src/app.ts, bash/bun test, search/"curation"). The
 * detail carries the rest of what Claude Code's own row shows, drawn dim, so
 * the restyle hides nothing.
 */

export type Row = {
  verb: string;
  arg: string;
  /** What else the call says (a path, a glob, an agent type), or null. */
  detail: string | null;
};

/** Longest a single input value is drawn in a detail, as Claude Code clips them too. */
const VALUE_MAX = 120;

/** The row for one call: the tool's name as Claude Code reports it, its input, the session's folder. */
export function rowOf(tool: string, input: unknown, cwd: string): Row {
  const args = isRecord(input) ? input : {};
  const text = (key: string): string | null => {
    const value = args[key];
    return typeof value === "string" && value !== "" ? value : null;
  };
  const path = (key: string): string => relative(text(key) ?? "", cwd);
  const details = (...parts: (string | null | false)[]): string | null => {
    const kept = parts.filter(
      (part): part is string => typeof part === "string" && part !== "",
    );
    return kept.length > 0 ? kept.join(" · ") : null;
  };

  switch (tool) {
    case "Read":
      return {
        verb: "read",
        arg: path("file_path"),
        detail: details(
          rangeOf(args),
          text("pages") && `pages ${text("pages")}`,
        ),
      };
    case "Edit":
      return {
        verb: "edit",
        arg: path("file_path"),
        detail: details(args.replace_all === true && "every match"),
      };
    case "MultiEdit": {
      const edits = Array.isArray(args.edits) ? args.edits.length : 0;
      return {
        verb: "edit",
        arg: path("file_path"),
        detail: details(edits > 0 && `${edits} edits`),
      };
    }
    case "Write":
      return { verb: "write", arg: path("file_path"), detail: null };
    case "NotebookEdit":
      return {
        verb: "edit",
        arg: path("notebook_path"),
        detail: details(
          text("cell_id") && `cell ${text("cell_id")}`,
          text("edit_mode"),
        ),
      };
    case "Bash":
      return {
        verb: "bash",
        arg: text("command") ?? "",
        detail: details(args.run_in_background === true && "in the background"),
      };
    case "Grep":
      return {
        verb: "search",
        arg: quoted(text("pattern") ?? ""),
        detail: details(
          text("path") && `in ${relative(text("path") ?? "", cwd)}`,
          text("glob"),
          text("type") && `type ${text("type")}`,
        ),
      };
    case "Glob":
      return {
        verb: "find",
        arg: text("pattern") ?? "",
        detail: details(
          text("path") && `in ${relative(text("path") ?? "", cwd)}`,
        ),
      };
    case "WebFetch":
      return { verb: "fetch", arg: pageOf(text("url") ?? ""), detail: null };
    case "WebSearch":
      return {
        verb: "search",
        arg: quoted(text("query") ?? ""),
        detail: "the web",
      };
    case "Agent":
    case "Task":
      return {
        verb: "agent",
        arg: text("description") ?? text("name") ?? "",
        detail: details(
          text("subagent_type"),
          args.run_in_background === true && "in the background",
        ),
      };
    case "Skill":
      return {
        verb: "skill",
        arg: text("skill") ?? text("command") ?? text("name") ?? "",
        detail: details(text("args")),
      };
    case "TodoWrite": {
      const todos = Array.isArray(args.todos) ? args.todos.length : 0;
      return {
        verb: "todo",
        arg: `${todos} ${todos === 1 ? "item" : "items"}`,
        detail: null,
      };
    }
    default:
      return tool.startsWith("mcp__")
        ? mcpRowOf(tool, args)
        : genericRowOf(tool, args);
  }
}

/** An MCP tool, mcp__<server>__<tool>, reads as <server>/<tool> with its arguments. */
function mcpRowOf(tool: string, args: Record<string, unknown>): Row {
  const [, server = "", name = ""] = /^mcp__(.+?)__(.+)$/.exec(tool) ?? [];
  // A plugin's server is plugin_<plugin>_<server>; the server's own name reads best.
  const plugin = /^plugin_[^_]+_(.+)$/.exec(server)?.[1];
  return {
    verb: lower(plugin ?? server),
    arg: name,
    detail: summaryOf(args),
  };
}

/** Any other tool: its name in lowercase words, and its input in brief. */
function genericRowOf(tool: string, args: Record<string, unknown>): Row {
  const verb = lower(tool);
  const summary = summaryOf(args);
  return { verb, arg: summary ?? "", detail: null };
}

/** "lines 10–59" for a Read with an offset or a limit. */
function rangeOf(args: Record<string, unknown>): string | null {
  const offset = typeof args.offset === "number" ? args.offset : null;
  const limit = typeof args.limit === "number" ? args.limit : null;
  if (offset === null && limit === null) return null;
  const first = offset ?? 1;
  return limit === null
    ? `from line ${first}`
    : `lines ${first}–${first + limit - 1}`;
}

/** An input in brief: each simple value as key: value. */
function summaryOf(args: Record<string, unknown>): string | null {
  const parts = Object.entries(args).flatMap(([key, value]) => {
    if (typeof value === "string") return [`${key}: ${clip(value)}`];
    if (typeof value === "number" || typeof value === "boolean")
      return [`${key}: ${String(value)}`];
    if (Array.isArray(value))
      return [
        `${key}: ${value.length} ${value.length === 1 ? "item" : "items"}`,
      ];
    return [];
  });
  return parts.length > 0 ? parts.join(", ") : null;
}

/** A path inside the session's folder, relative to it; any other path as given. */
export function relative(path: string, cwd: string): string {
  if (cwd === "" || path === "") return path;
  const base = cwd.endsWith("/") ? cwd : `${cwd}/`;
  if (path.startsWith(base)) return path.slice(base.length);
  return path === cwd ? "." : path;
}

/** A URL as its host and path: allthings.dev/events. */
export function pageOf(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.host.replace(/^www\./, "");
    const rest = `${parsed.pathname === "/" ? "" : parsed.pathname}${parsed.search}`;
    return `${host}${rest}`;
  } catch {
    return url;
  }
}

/** "ExitPlanMode" reads as exit-plan-mode, "list_events" as itself. */
function lower(name: string): string {
  return name
    .replaceAll(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replaceAll(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}

function quoted(text: string): string {
  return `"${text}"`;
}

function clip(text: string): string {
  const line = text.replaceAll(/\s+/g, " ").trim();
  return line.length > VALUE_MAX ? `${line.slice(0, VALUE_MAX - 1)}…` : line;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
