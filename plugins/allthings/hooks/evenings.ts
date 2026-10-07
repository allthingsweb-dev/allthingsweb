/**
 * Evenings from the site's MCP server: where the server is, how to ask it,
 * what its answers mean, and what the band and `/at` say about them.
 *
 * Everything here is plain functions of their arguments; register.tsx makes
 * the calls through `$`.
 */

import type { Evening, EveningTalk } from "../types";
import { neighborhoodOf } from "./city";
import {
  clockOf,
  dayOf,
  isEveningStart,
  isSameDay,
  spanOf,
  untilOf,
} from "./time";

/** How long a fetched next evening counts as fresh: refresh about every 30 minutes. */
export const FRESH_MS = 30 * 60_000;

/** How long a cached evening outlives a failed refresh before the band goes quiet. */
export const GRACE_MS = 2 * 60 * 60_000;

/** The wordmark, always one word, the cursor after the slash. */
export const WORDMARK = "allthings";

/**
 * The MCP server's URL from a plugin MCP config (`mcpServers`, or servers at
 * the top level): the `allthings` server's, else the first with an http(s)
 * URL. Null when the file names none.
 */
export function endpointOf(configText: string): string | null {
  let config: unknown;
  try {
    config = JSON.parse(configText);
  } catch {
    return null;
  }
  if (!isRecord(config)) return null;
  const servers = isRecord(config.mcpServers) ? config.mcpServers : config;
  const named = servers.allthings;
  const candidates = [named, ...Object.values(servers)];
  for (const server of candidates) {
    if (isRecord(server) && typeof server.url === "string") {
      const url = parseUrl(server.url);
      if (
        url !== null &&
        (url.protocol === "https:" || url.protocol === "http:")
      ) {
        return url.href;
      }
    }
  }
  return null;
}

/** The body of a JSON-RPC `tools/call` request for one tool. */
export function toolCallBody(
  name: string,
  args: Record<string, unknown>,
): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name, arguments: args },
  });
}

/** The headers a stateless streamable-HTTP MCP server takes a call with. */
export const TOOL_CALL_HEADERS: Readonly<Record<string, string>> = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
  "mcp-protocol-version": "2025-06-18",
};

/** A tool's answer: its structured content, or the text of its error. */
export type ToolAnswer =
  | { isError: false; structured: unknown }
  | { isError: true; message: string };

/**
 * Reads one JSON-RPC answer from a JSON or event-stream body. Throws when the
 * body is neither, or the server answered with an RPC error.
 */
export function toolAnswerOf(body: string, contentType: string): ToolAnswer {
  const json = contentType.includes("text/event-stream")
    ? body
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice("data:".length).trim())
        .join("")
    : body;
  const rpc: unknown = JSON.parse(json);
  if (!isRecord(rpc)) throw new Error("not a JSON-RPC answer");
  if (isRecord(rpc.error)) {
    const message = rpc.error.message;
    throw new Error(
      typeof message === "string" ? message : "the server refused the call",
    );
  }
  const result = rpc.result;
  if (!isRecord(result)) throw new Error("no result");
  if (result.isError === true) {
    const content = Array.isArray(result.content) ? result.content : [];
    const message = content
      .map((part: unknown) =>
        isRecord(part) && typeof part.text === "string" ? part.text : "",
      )
      .join("\n");
    return { isError: true, message };
  }
  return { isError: false, structured: result.structuredContent };
}

/**
 * The topic of allthings/<topic> from an evening's name: what follows "all
 * things" ("All Things Agent Setups" is agent-setups), else the name less its
 * city ("Effect San Francisco" is effect). Lowercase, words joined by "-".
 */
export function topicOf(name: string): string {
  const plain = name
    .replaceAll(/[^\p{L}\p{N}\s/&.+-]/gu, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
  const after = /^all\s*things\s*[/:–-]?\s*(.+)$/i.exec(plain)?.[1];
  const topic = (after ?? plain.replace(/\s+(san francisco|sf)$/i, "")).trim();
  const slug = topic
    .toLowerCase()
    .replaceAll(/\s+/g, "-")
    .replaceAll(/[^\p{L}\p{N}.+-]/gu, "");
  return slug === "" ? "_" : slug;
}

/** An EventSummary (`list_events`) or Event (`get_event`) as an Evening; null when it isn't one. */
export function eveningOf(raw: unknown): Evening | null {
  if (!isRecord(raw)) return null;
  const { slug, name, url, status, startsAt, endsAt } = raw;
  if (
    typeof slug !== "string" ||
    typeof name !== "string" ||
    typeof url !== "string" ||
    typeof startsAt !== "string" ||
    typeof endsAt !== "string" ||
    !Number.isFinite(Date.parse(startsAt)) ||
    !Number.isFinite(Date.parse(endsAt))
  ) {
    return null;
  }
  const venue = isRecord(raw.venue) ? raw.venue : null;
  const venueName = typeof venue?.name === "string" ? venue.name : null;
  const address = typeof venue?.address === "string" ? venue.address : null;
  const hosts = Array.isArray(raw.hosts)
    ? raw.hosts.flatMap((host: unknown) =>
        isRecord(host) && typeof host.name === "string" ? [host.name] : [],
      )
    : [];
  const talks: EveningTalk[] = Array.isArray(raw.talks)
    ? raw.talks.flatMap((talk: unknown) =>
        isRecord(talk) && typeof talk.title === "string"
          ? [
              {
                title: talk.title,
                speakers: Array.isArray(talk.speakers)
                  ? talk.speakers.flatMap((speaker: unknown) =>
                      isRecord(speaker) && typeof speaker.name === "string"
                        ? [speaker.name]
                        : [],
                    )
                  : [],
              },
            ]
          : [],
      )
    : [];
  return {
    slug,
    name,
    topic: topicOf(name),
    url,
    status: status === "live" || status === "past" ? status : "upcoming",
    startsAt,
    endsAt,
    venueName,
    address,
    neighborhood: neighborhoodOf(address),
    rsvpUrl: typeof raw.rsvpUrl === "string" ? raw.rsvpUrl : null,
    recordingUrl:
      typeof raw.recordingUrl === "string" ? raw.recordingUrl : null,
    isHackathon: raw.isHackathon === true,
    hosts,
    talks,
  };
}

/** The evenings of a `list_events` answer, in the server's order. */
export function eveningsOf(structured: unknown): Evening[] {
  if (!isRecord(structured) || !Array.isArray(structured.events)) {
    throw new Error("list_events answered without events");
  }
  return structured.events.flatMap((raw: unknown) => {
    const evening = eveningOf(raw);
    return evening === null ? [] : [evening];
  });
}

/** Where an evening stands at an instant. */
export type Phase =
  /** Ahead, on another day. */
  | "upcoming"
  /** Ahead, later today in San Francisco. */
  | "today"
  /** Started and not yet over. */
  | "live"
  /** Over. */
  | "past";

export function phaseOf(evening: Evening, now: number): Phase {
  const starts = Date.parse(evening.startsAt);
  const ends = Date.parse(evening.endsAt);
  if (now >= ends) return "past";
  if (now >= starts || evening.status === "live") return "live";
  return isSameDay(starts, now) ? "today" : "upcoming";
}

/** The host to name: the hosting companies `get_event` gave, else the venue's name. */
export function hostOf(evening: Evening): string | null {
  if (evening.hosts.length > 0) return evening.hosts.join(" & ");
  return evening.venueName;
}

/** The band's first slot: the date, the countdown on the day, or "live now". */
export function whenOf(evening: Evening, now: number): string {
  const starts = Date.parse(evening.startsAt);
  const phase = phaseOf(evening, now);
  if (phase === "live") return "live now";
  if (phase === "today")
    return `${isEveningStart(starts) ? "tonight" : "today"} · in ${untilOf(now, starts)}`;
  if (phase === "upcoming") return `${dayOf(starts)} · ${clockOf(starts)}`;
  return dayOf(starts);
}

/** The lockup, allthings/<topic>, with the cursor while the evening hasn't happened. */
export function lockupOf(
  evening: Evening,
  now: number,
  cursor: string,
): string {
  return `${WORDMARK}/${evening.topic}${phaseOf(evening, now) === "past" ? "" : cursor}`;
}

/** The sign-off after someone says they're in. */
export function signOffOf(evening: Evening): string {
  return `see you at/${evening.topic}`;
}

/** An address less its city, state and country: "201 Spear St 12th floor". */
export function streetOf(address: string): string {
  return address
    .replace(/,\s*(san francisco|sf)\b.*$/i, "")
    .replace(/^[^,0-9]+,\s*(?=\d)/, "")
    .trim();
}

/** A URL as a person reads it: no scheme, no www, no trailing slash. */
export function shortUrl(url: string): string {
  return url
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/$/, "");
}

/**
 * The text `/at` prints, which Claude reads too: the lockup, when and where,
 * who's on stage, and where to say you're in.
 */
export function cardText(evening: Evening, now: number): string {
  const starts = Date.parse(evening.startsAt);
  const ends = Date.parse(evening.endsAt);
  const phase = phaseOf(evening, now);
  const host = hostOf(evening);
  const lines = [lockupOf(evening, now, "_")];
  const when =
    phase === "live"
      ? `live now, until ${clockOf(ends)}`
      : `${dayOf(starts)} · ${spanOf(starts, ends)}${phase === "today" ? ` · in ${untilOf(now, starts)}` : ""}`;
  lines.push(
    [when, evening.neighborhood, host === null ? null : `hosted at ${host}`]
      .filter((part) => part !== null)
      .join(" · "),
  );
  if (evening.address !== null) lines.push(streetOf(evening.address));
  for (const talk of evening.talks) {
    lines.push(
      talk.speakers.length > 0
        ? `· ${talk.title} — ${talk.speakers.join(", ")}`
        : `· ${talk.title}`,
    );
  }
  if (phase === "past") {
    if (evening.recordingUrl !== null)
      lines.push(`recording → ${evening.recordingUrl}`);
  } else if (evening.rsvpUrl !== null) {
    lines.push(`I'm in → ${evening.rsvpUrl}`);
  }
  lines.push(evening.url);
  return lines.join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseUrl(text: string): URL | null {
  try {
    return new URL(text);
  } catch {
    return null;
  }
}
