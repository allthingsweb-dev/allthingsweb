/**
 * allthings/_ for Claude Code: tool rows in the slash grammar, the spinner as
 * the wordmark wandering the city, the next evening in a Night band above the
 * prompt, and /at and /imin, which answer at once with no turn.
 *
 * Every hook here restyles; none hides what Claude Code shows. A failure to
 * reach the site is quiet: no band, and a plain line from the commands.
 *
 * The engine reads `on(...)` and `$.noun.method(...)` from this source, so
 * they are spelled in full, and the helpers that take `$` are top-level
 * functions of this file.
 */

import { atom, read, update } from "claude-code";
import type { CommandSpec, EngineInterface, Register } from "claude-code";

import type { Card, Evening } from "../types";
import { phraseAt, seedOf } from "./city";
import {
  cardText,
  endpointOf,
  eveningOf,
  eveningsOf,
  FRESH_MS,
  GRACE_MS,
  hostOf,
  phaseOf,
  shortUrl,
  signOffOf,
  streetOf,
  TOOL_CALL_HEADERS,
  toolAnswerOf,
  toolCallBody,
  whenOf,
  WORDMARK,
  type ToolAnswer,
} from "./evenings";
import {
  BRIDGE,
  DUSK,
  GLOW,
  LAVENDER,
  NIGHT,
  PAPER,
  slashColorOf,
  VIOLET,
} from "./palette";
import { rowOf } from "./rows";
import { clockOf, dayOf, spanOf } from "./time";

type Engine = EngineInterface;

const nextEvening = atom({ plugin: "allthings", key: "next" } as const, null);
const fetchedAt = atom({ plugin: "allthings", key: "fetchedAt" } as const, 0);
const clock = atom({ plugin: "allthings", key: "now" } as const, 0);
const tick = atom({ plugin: "allthings", key: "tick" } as const, 0);
const clicked = atom({ plugin: "allthings", key: "clicked" } as const, []);
const slash = atom({ plugin: "allthings", key: "slash" } as const, GLOW);
const reduceMotion = atom(
  { plugin: "allthings", key: "reduceMotion" } as const,
  false,
);
const cards = atom({ plugin: "allthings", key: "cards" } as const, {});

/** The cursor blinks once a second: on for half of it, off for the other. */
export const BLINK_MS = 500;

/** The band's clock, and the check for a stale or finished evening, move this often. */
export const MINUTE_MS = 30_000;

/** The spinner's line moves on to the next neighborhood every this many blinks (6 seconds). */
export const PHRASE_TICKS = 12;

/** After a failed refresh, wait this long before asking again for an evening that just ended. */
const RETRY_MS = 5 * 60_000;

/** How many /at cards the session keeps drawable. */
const CARDS_KEPT = 20;

/** The session's folder, to draw paths relative to it. */
let cwd = "";
/** Whether a main-loop turn is running, so the spinner's cursor blinks. */
let isWorking = false;
/** Where this turn's walk through the city starts. */
let seed = 0;
/** When the mod last asked the site, successfully or not. */
let attemptedAt = 0;
/** The refresh under way, which every caller meanwhile shares. */
let refreshing: Promise<Evening | null | undefined> | null = null;
/** Tool calls drawn inside an expanded group, whose rows carry their output. */
const unfolded = new Set<string>();

export const register: Register = (on) => {
  on("session.start", async ($, e, next) => {
    cwd = e.cwd;
    const started = await next(e);
    await loadSaved($);
    await readSettings($);
    await minute($, { refresh: false });
    // Only a session someone watches draws the band and the cursor; a
    // headless run (claude -p, the SDK) asks the site only when a command does.
    if (e.isInteractive) {
      $.clock.every(BLINK_MS, () => {
        void blink($);
      });
      $.clock.every(MINUTE_MS, () => {
        void minute($, { refresh: true });
      });
      // Ask the site once the session is up, never holding its start.
      $.clock.after(1, () => {
        void minute($, { refresh: true });
      });
    }
    await offer($, {
      name: "at",
      description: "The next allthings evening, or any evening by its slug",
      argumentHint: "[slug]",
      immediate: true,
    });
    await offer($, {
      name: "imin",
      description: "Open the next allthings evening's page to say you're in",
      immediate: true,
    });
    return started;
  });

  // /clear, /resume and /branch reset $.state without a new session.start.
  on(
    "classic.SessionStart",
    { source: ["clear", "resume", "fork"] },
    async ($, e, next) => {
      const result = await next(e);
      await loadSaved($);
      await readSettings($);
      await minute($, { refresh: false });
      return result;
    },
  ).catch(($, e, beneath) => beneath(e));

  on("config.set", { key: ["theme", "reduceMotion"] }, async ($, e, next) => {
    const result = await next(e);
    if (result.deny === undefined) await readSettings($);
    return result;
  }).catch(($, e, beneath) => beneath(e));

  on("turn.start", async ($, e, next) => {
    isWorking = true;
    seed = seedOf(e.turnId);
    return next(e);
  });

  on("turn.complete", async ($, e, next) => {
    if (e.agentId === undefined) isWorking = false;
    return next(e);
  });

  // The spinner: allthings/_ with its cursor, then a working verb somewhere in
  // the city. Claude Code keeps drawing the elapsed time and tokens after it.
  on("ui.render", { component: "Spinner" }, async ($, e, next) => {
    const isStill = await read($, reduceMotion);
    const t = await read($, tick);
    const mark = `${WORDMARK}/${!isStill && t % 2 === 1 ? " " : "_"}`;
    if (e.props.message !== null) {
      return next({
        ...e,
        props: { ...e.props, message: `${mark} · ${e.props.message}` },
      });
    }
    // The desktop's word says what the step is doing: keep it.
    if (e.surface !== "terminal" && e.props.word !== "Working") {
      return next({
        ...e,
        props: { ...e.props, word: `${mark} · ${e.props.word}` },
      });
    }
    const phrase = phraseAt(seed + Math.floor(t / PHRASE_TICKS));
    return next({ ...e, props: { ...e.props, word: `${mark} ${phrase}` } });
  });

  // An expanded group draws each call's output in its row: those rows stay
  // Claude Code's own, so nothing is lost.
  on("ui.render", { component: "ToolGroup" }, ($, e, next) => {
    if (e.props.isExpanded) {
      for (const call of e.props.calls) {
        if (call.tool_use_id !== undefined) unfolded.add(call.tool_use_id);
      }
    }
    return next(e);
  });

  // A tool call's row in the slash grammar: read/src/app.ts. The status dot,
  // the error color and "Interrupted" stay; the result below is Claude Code's.
  on("ui.render", { component: "ToolUse" }, async ($, e, next) => {
    // The desktop's rows expand and collapse themselves: leave them be.
    if (e.surface !== "terminal" || unfolded.has(e.props.tool_use_id))
      return next(e);
    const { Box, Text } = $.ui.resolve(e);
    const row = rowOf(e.props.tool, e.props.input, cwd);
    const color = await read($, slash);
    const isFailed = e.props.isErrored || e.props.isInterrupted;
    const isDim =
      e.props.isRunning &&
      !(await read($, reduceMotion)) &&
      (await read($, tick)) % 2 === 1;
    const dot = isFailed ? "error" : e.props.isRunning ? "inactive" : "success";
    return (
      <Box key={`row-${e.props.tool_use_id}`} flexDirection="column">
        <Box flexDirection="row">
          <Text color={dot} dimColor={isDim}>
            {"⏺ "}
          </Text>
          <Text>
            <Text bold>{row.verb}</Text>
            <Text color={color}>/</Text>
            {row.arg}
            {row.detail === null ? null : (
              <Text dimColor>{` (${row.detail})`}</Text>
            )}
          </Text>
        </Box>
        {e.props.isInterrupted ? (
          <Text color="error">{"  ⎿  Interrupted"}</Text>
        ) : null}
      </Box>
    );
  });

  // The band: the next evening on Night, and a button to say you're in.
  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e);
    const evening = await read($, nextEvening);
    if (evening === null) return next(e);
    const now = await read($, clock);
    const phase = phaseOf(evening, now);
    if (phase === "past") return next(e);
    const isIn = (await read($, clicked)).includes(evening.slug);
    const isStill = await read($, reduceMotion);
    const cursor = !isStill && (await read($, tick)) % 2 === 1 ? " " : "_";
    const host = hostOf(evening);
    const columns = e.props.bodyColumns;
    const { Box, Text, Button } = $.ui.resolve(e);
    return (
      <Box
        key="band"
        flexDirection="row"
        backgroundColor={NIGHT}
        paddingX={1}
        columnGap={2}
      >
        <Box flexGrow={1} flexShrink={1}>
          <Text color={DUSK} wrap="truncate-end">
            <Text
              color={phase === "live" ? GLOW : DUSK}
              bold={phase === "live"}
            >
              {whenOf(evening, now)}
            </Text>
            {" · "}
            <Text color={PAPER} bold>
              {WORDMARK}
              <Text color={GLOW}>/</Text>
              {`${evening.topic}${cursor}`}
            </Text>
            {evening.neighborhood !== null && columns >= 56 ? (
              <Text color={LAVENDER}>{` · ${evening.neighborhood}`}</Text>
            ) : null}
            {host !== null && columns >= 80 ? ` · hosted at ${host}` : null}
          </Text>
        </Box>
        {isIn ? (
          <Text color={PAPER}>
            see you at<Text color={GLOW}>/</Text>
            {evening.topic}
          </Text>
        ) : evening.rsvpUrl === null ? null : (
          <Button
            key="imin"
            label="I'm in →"
            variant="primary"
            onPress={() => sayImIn($, evening)}
          />
        )}
      </Box>
    );
  });

  on("command.run", { command: "at" }, async ($, e) => {
    const slug = e.args.trim();
    const endpoint = await endpointFor($);
    if (endpoint === null) return { text: UNCONFIGURED };
    let evening: Evening | null | undefined;
    if (slug === "") {
      const upcoming = await upcomingEvening($, true);
      if (upcoming === undefined) return { text: unreachable(endpoint) };
      if (upcoming === null) {
        return { text: nothingAhead(endpoint) };
      }
      evening = (await eveningBySlug($, endpoint, upcoming.slug)) ?? upcoming;
    } else {
      evening = await eveningBySlug($, endpoint, slug);
      if (evening === undefined) return { text: unreachable(endpoint) };
      if (evening === null)
        return { text: `no evening at ${slug}. /at shows the next one.` };
    }
    const now = await $.clock.now();
    const card: Card = { evening, at: now };
    await update($, cards, (kept) => keepCard(kept, slug, card));
    return { text: cardText(evening, now) };
  }).catch(() => ({ text: STUMBLED }));

  on("command.run", { command: "imin" }, async ($) => {
    const endpoint = await endpointFor($);
    if (endpoint === null) return { text: UNCONFIGURED };
    const upcoming = await upcomingEvening($, false);
    if (upcoming === undefined) return { text: unreachable(endpoint) };
    if (upcoming === null) {
      return { text: nothingAhead(endpoint) };
    }
    if (upcoming.rsvpUrl === null) {
      return {
        text: `${upcoming.name} has no page to say you're in yet. ${upcoming.url}`,
      };
    }
    const isOpened = await sayImIn($, upcoming);
    return {
      text: isOpened
        ? `${signOffOf(upcoming)} · opened ${shortUrl(upcoming.rsvpUrl)}`
        : `${signOffOf(upcoming)} · say you're in at ${upcoming.rsvpUrl}`,
    };
  }).catch(() => ({ text: STUMBLED }));

  // /at's row as a card: the lockup with its slash, when and where, who's on
  // stage, and the links. The text it draws from is the one Claude reads.
  on(
    "ui.render",
    { component: "CommandOutput", props: { command: "at" } },
    async ($, e, next) => {
      if (e.props.isErrored) return next(e);
      const card = (await read($, cards))[e.props.args.trim()];
      if (card === undefined) return next(e);
      const { evening, at } = card;
      const color = await read($, slash);
      const hoodColor = color === BRIDGE ? VIOLET : LAVENDER;
      const phase = phaseOf(evening, at);
      const starts = Date.parse(evening.startsAt);
      const ends = Date.parse(evening.endsAt);
      const host = hostOf(evening);
      const action =
        phase === "past"
          ? evening.recordingUrl === null
            ? null
            : (["recording → ", evening.recordingUrl] as const)
          : evening.rsvpUrl === null
            ? null
            : (["I'm in → ", evening.rsvpUrl] as const);
      const { Box, Text, Link } = $.ui.resolve(e);
      const linkTo = (href: string) => {
        const safe = httpsHref(href);
        return safe === null ? (
          <Text>{href}</Text>
        ) : (
          <Link href={safe} label={shortUrl(href)} />
        );
      };
      return (
        <Box key="card" flexDirection="column">
          <Text bold>
            {WORDMARK}
            <Text color={color}>/</Text>
            {`${evening.topic}${phase === "past" ? "" : "_"}`}
          </Text>
          <Text>
            <Text dimColor>
              {phase === "live"
                ? `live now, until ${clockOf(ends)}`
                : `${dayOf(starts)} · ${spanOf(starts, ends)}`}
            </Text>
            {evening.neighborhood === null ? null : (
              <Text color={hoodColor}>{` · ${evening.neighborhood}`}</Text>
            )}
            {host === null ? null : (
              <Text dimColor>{` · hosted at ${host}`}</Text>
            )}
          </Text>
          {evening.address === null ? null : (
            <Text dimColor>{streetOf(evening.address)}</Text>
          )}
          {evening.talks.map((talk) => (
            <Text>
              {"· "}
              {talk.title}
              {talk.speakers.length > 0 ? (
                <Text dimColor>{` — ${talk.speakers.join(", ")}`}</Text>
              ) : null}
            </Text>
          ))}
          {action === null ? null : (
            <Text>
              {action[0]}
              {linkTo(action[1])}
            </Text>
          )}
          <Text dimColor>{linkTo(evening.url)}</Text>
        </Box>
      );
    },
  );
};

/** Registers a command; a name a built-in or another plugin already took costs only that command. */
async function offer($: Engine, command: CommandSpec): Promise<void> {
  try {
    await $.command.register(command);
  } catch {
    // The other command and the rest of the mod still run.
  }
}

/** Copies what earlier sessions saved into the session's state. */
async function loadSaved($: Engine): Promise<void> {
  const saved = await stored($, "next");
  if (isRecord(saved) && typeof saved.fetchedAt === "number") {
    const evening = eveningOf(saved.raw);
    await update($, nextEvening, () => evening);
    await update($, fetchedAt, () => Number(saved.fetchedAt));
  }
  const said = await stored($, "clicked");
  if (Array.isArray(said)) {
    const slugs = said.filter(
      (slug): slug is string => typeof slug === "string",
    );
    await update($, clicked, () => slugs);
  }
}

/** The theme's slash color and the reduce-motion setting, from /config. */
async function readSettings($: Engine): Promise<void> {
  let rows: Awaited<ReturnType<Engine["config"]["list"]>> = [];
  try {
    rows = await $.config.list();
  } catch {
    // No settings to read: the defaults, Glow and motion, stand.
  }
  const theme = rows.find((row) => row.key === "theme")?.value;
  const still = rows.find((row) => row.key === "reduceMotion")?.value === true;
  const colorFgBg = await $.env.get("COLORFGBG");
  await update($, slash, () => slashColorOf(theme, colorFgBg));
  await update($, reduceMotion, () => still);
}

/** Half a second on: the cursor blinks while a turn runs or the band shows. */
async function blink($: Engine): Promise<void> {
  if (await read($, reduceMotion)) return;
  if (!isWorking && (await read($, nextEvening)) === null) return;
  await update($, tick, (n) => (n + 1) % 1_000_000);
}

/** The band's clock, and a refresh when the evening is stale or over. */
async function minute($: Engine, options: { refresh: boolean }): Promise<void> {
  const now = await $.clock.now();
  await update($, clock, () => now);
  if (!options.refresh) return;
  const evening = await read($, nextEvening);
  const lastAsked = Math.max(await read($, fetchedAt), attemptedAt);
  const isStale = now - lastAsked >= FRESH_MS;
  const isOver =
    evening !== null &&
    Date.parse(evening.endsAt) <= now &&
    now - attemptedAt >= RETRY_MS;
  if (isStale || isOver) await refresh($);
}

/** The next evening: the cached one while fresh, else the site's; undefined when the site can't be reached. */
async function upcomingEvening(
  $: Engine,
  isForced: boolean,
): Promise<Evening | null | undefined> {
  const now = await $.clock.now();
  const cached = await read($, nextEvening);
  const isFresh = now - (await read($, fetchedAt)) < FRESH_MS;
  const isCurrent = cached === null || Date.parse(cached.endsAt) > now;
  if (!isForced && isFresh && isCurrent) return cached;
  return refresh($);
}

/**
 * Asks the site for the next evening (list_events, upcoming, limit 1) and
 * keeps it; a call while one is under way gets that one's answer, so a
 * timer and a command never ask twice. Resolves undefined when the site
 * couldn't be reached.
 */
function refresh($: Engine): Promise<Evening | null | undefined> {
  refreshing ??= askForNext($).finally(() => {
    refreshing = null;
  });
  return refreshing;
}

/**
 * One request for the next evening, kept in $.state and the store. On a
 * failure the cached evening stays for GRACE_MS, then the band goes quiet.
 */
async function askForNext($: Engine): Promise<Evening | null | undefined> {
  const now = await $.clock.now();
  attemptedAt = now;
  const endpoint = await endpointFor($);
  try {
    if (endpoint === null) throw new Error("no MCP server configured");
    const answer = await callTool($, endpoint, "list_events", {
      when: "upcoming",
      limit: 1,
    });
    if (answer.isError) throw new Error(answer.message);
    const [first = null] = eveningsOf(answer.structured);
    await update($, nextEvening, () => first);
    await update($, fetchedAt, () => now);
    await save($, "next", { raw: rawOf(first), fetchedAt: now });
    return first;
  } catch {
    if (now - (await read($, fetchedAt)) >= GRACE_MS) {
      await update($, nextEvening, () => null);
    }
    return undefined;
  }
}

/** One evening by slug (get_event): null when the site has none by it, undefined when unreachable. */
async function eveningBySlug(
  $: Engine,
  endpoint: string,
  slug: string,
): Promise<Evening | null | undefined> {
  try {
    const answer = await callTool($, endpoint, "get_event", { slug });
    if (answer.isError)
      return answer.message.startsWith("No published event") ? null : undefined;
    return eveningOf(answer.structured);
  } catch {
    return undefined;
  }
}

/** One tool call to the plugin's MCP server over HTTP, stateless. */
async function callTool(
  $: Engine,
  endpoint: string,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolAnswer> {
  const response = await $.http.fetch(endpoint, {
    method: "POST",
    headers: { ...TOOL_CALL_HEADERS },
    body: toolCallBody(name, args),
  });
  if (!response.ok) throw new Error(`${endpoint} answered ${response.status}`);
  return toolAnswerOf(response.text, response.headers["content-type"] ?? "");
}

/** The MCP server's URL as this plugin configures it, read fresh so a config change carries over. */
async function endpointFor($: Engine): Promise<string | null> {
  for (const file of [".mcp.json", "mcp.json"]) {
    try {
      const endpoint = endpointOf(await $.fs.read(`${$.plugin.root}/${file}`));
      if (endpoint !== null) return endpoint;
    } catch {
      // No such file: try the next.
    }
  }
  return null;
}

/** Opens the evening's page, and remembers that this person said they're in. */
async function sayImIn($: Engine, evening: Evening): Promise<boolean> {
  if (evening.rsvpUrl === null) return false;
  const isOpened = await openUrl($, evening.rsvpUrl);
  if (!isOpened) $.ui.toast(`I'm in → ${evening.rsvpUrl}`);
  await update($, clicked, (slugs) =>
    slugs.includes(evening.slug) ? slugs : [...slugs, evening.slug],
  );
  await save($, "clicked", await read($, clicked));
  return isOpened;
}

/** A value an earlier session kept, or undefined when the store can't be read. */
async function stored($: Engine, key: string): Promise<unknown> {
  try {
    return await $.store.get(key);
  } catch {
    return undefined;
  }
}

/** Keeps a value for later sessions; a store that can't be written costs only that. */
async function save($: Engine, key: string, value: unknown): Promise<void> {
  try {
    await $.store.set(key, value);
  } catch {
    // The session goes on with what it holds in $.state.
  }
}

/** Opens a URL in the person's browser: macOS, then Linux, then Windows. */
async function openUrl($: Engine, url: string): Promise<boolean> {
  for (const argv of [
    ["open", url],
    ["xdg-open", url],
    ["cmd", "/c", "start", "", url],
  ]) {
    try {
      const run = await $.process.run(argv, { timeoutMs: 10_000 });
      if (run.exitCode === 0) return true;
    } catch {
      // Not this platform's opener.
    }
  }
  return false;
}

/** What the commands say when the plugin names no MCP server. */
const UNCONFIGURED =
  "the allthings MCP server isn't configured in this plugin.";

/** What the commands say when something unexpected stopped them. */
const STUMBLED = "allthings couldn't answer just now. try again in a minute.";

function nothingAhead(endpoint: string): string {
  return `no evening on the calendar right now. ${new URL(endpoint).origin} has what's next.`;
}

function unreachable(endpoint: string): string {
  return `couldn't reach ${new URL(endpoint).host} just now. try again in a minute.`;
}

function keepCard(
  kept: Readonly<Record<string, Card>>,
  key: string,
  card: Card,
): Record<string, Card> {
  const entries = Object.entries(kept).filter(([name]) => name !== key);
  return Object.fromEntries([...entries.slice(-(CARDS_KEPT - 1)), [key, card]]);
}

/** An Evening as the store keeps it: in the site's own shape, read back through eveningOf. */
function rawOf(evening: Evening | null): unknown {
  if (evening === null) return null;
  return {
    slug: evening.slug,
    name: evening.name,
    url: evening.url,
    status: evening.status,
    startsAt: evening.startsAt,
    endsAt: evening.endsAt,
    venue: { name: evening.venueName, address: evening.address },
    rsvpUrl: evening.rsvpUrl,
    recordingUrl: evening.recordingUrl,
    isHackathon: evening.isHackathon,
  };
}

/** A URL a Link takes: https only, spelled as URL spells it. */
function httpsHref(href: string): string | null {
  try {
    const url = new URL(href);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
