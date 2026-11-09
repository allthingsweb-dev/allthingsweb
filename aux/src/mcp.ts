import { createHash, timingSafeEqual } from "node:crypto";
import {
  type CallToolResult,
  createMcpHandler,
  McpServer,
} from "@modelcontextprotocol/server";
import { z } from "zod";
import packageJson from "../package.json" with { type: "json" };
import type { CodeBook } from "./codes.ts";
import type { Config } from "./config.ts";
import type { Hue } from "./hue.ts";
import type { AuditLog } from "./log.ts";
import type { Music } from "./music.ts";
import { type AddressLimiter, type LightColor, Policy } from "./policy.ts";

/**
 * The hub's MCP server at `/mcp`: stateless JSON-RPC over HTTP, as the
 * site's own server and the allthings CLI speak it (web/src/mcp/,
 * cli/src/client.ts). Every request gets a fresh server that knows who is
 * calling, from `Authorization: Bearer <code>`:
 *
 * - anyone may list the tools; the guest tools then answer `unauthorized`
 * - a guest code calls the five guest tools
 * - the host token also sees and calls the four host tools
 *
 * A refusal is a tool error whose structured content, repeated as JSON in
 * its text, has a stable `code`, a `message`, and `retry_after_seconds`
 * when rate limited, so clients can word it.
 */

export type ErrorCode =
  | "rate_limited"
  | "frozen"
  | "unknown_scene"
  | "unknown_color"
  | "unknown_zone"
  | "not_holder"
  | "unauthorized"
  | "bridge_unavailable"
  | "unknown_code"
  | "ambiguous_prefix"
  | "unknown_track"
  | "queue_full"
  | "already_queued"
  | "night_limit"
  | "skip_used"
  | "nothing_playing";

export type Caller =
  | { readonly kind: "guest"; readonly id: string }
  | { readonly kind: "host" }
  | { readonly kind: "anonymous" };

type Outcome =
  | { readonly ok: true; readonly value: Record<string, unknown> }
  | {
      readonly ok: false;
      readonly code: ErrorCode;
      readonly message: string;
      readonly retryAfterSeconds?: number;
    };

const ok = (value: Record<string, unknown>): Outcome => ({ ok: true, value });

const refuse = (
  code: ErrorCode,
  message: string,
  retryAfterSeconds?: number,
): Outcome =>
  retryAfterSeconds === undefined
    ? { ok: false, code, message }
    : { ok: false, code, message, retryAfterSeconds };

const messages = {
  unauthorized:
    "This needs an aux code from the check-in table, sent as Authorization: Bearer <code>.",
  frozen: "The host has paused guest control for now.",
  not_holder: "Only the guest holding the aux can pass it.",
  bridge_unavailable: "The lights didn't answer. Try again in a moment.",
  unknown_track: "That isn't a track in tonight's set; list_tracks has them.",
  queue_full: "The queue is full (8 tracks). Try again once one plays.",
  already_queued: "You have a track waiting; queue another once it plays.",
  night_limit: "You've queued your 2 tracks for tonight.",
  skip_used: "You've used this turn's skip.",
  nothing_playing: "Nothing is playing right now.",
} as const;

const rateLimited = (seconds: number): Outcome =>
  refuse(
    "rate_limited",
    `Easy on the lights: try again in ${seconds} s.`,
    seconds,
  );

/** A key of `record` named by `input`, ignoring case and outer spaces. */
function lookup<T>(record: Readonly<Record<string, T>>, input: string) {
  const name = input.trim().toLowerCase();
  return Object.hasOwn(record, name)
    ? { name, value: record[name] as T }
    : undefined;
}

const sha256 = (value: string) => createHash("sha256").update(value).digest();

export interface HubDeps {
  readonly config: Config;
  readonly hue: Pick<Hue, "setGroupedLight">;
  readonly codes: CodeBook;
  readonly log: AuditLog;
  readonly policy?: Policy;
  /** Tonight's music; without it, the music tools stay out of tools/list. */
  readonly music?: Music;
  readonly now?: () => number;
}

/** The tools' behavior, apart from MCP: policy, then the Bridge, then the log. */
export class Hub {
  readonly config: Config;
  readonly policy: Policy;
  readonly music: Music | undefined;
  /** The turns (holder and start) whose skip was used. */
  readonly #skippedTurns = new Set<string>();
  readonly #hue: Pick<Hue, "setGroupedLight">;
  readonly #codes: CodeBook;
  readonly #log: AuditLog;
  readonly #now: () => number;
  readonly #hostToken: Buffer;
  readonly #started: number;
  #bridge: { lastOkAt?: string; lastErrorAt?: string; lastError?: string } = {};

  constructor({
    config,
    hue,
    codes,
    log,
    policy,
    music,
    now = Date.now,
  }: HubDeps) {
    this.config = config;
    this.music = music;
    this.policy = policy ?? new Policy({ frozen: config.startFrozen });
    this.#hue = hue;
    this.#codes = codes;
    this.#log = log;
    this.#now = now;
    this.#hostToken = sha256(config.hostToken);
    this.#started = now();
  }

  /** Who `authorization` (the header) names. A bad code is anonymous. */
  identify(authorization: string | null): Caller {
    const match = /^Bearer\s+(\S.*)$/i.exec(authorization?.trim() ?? "");
    const token = match?.[1]?.trim();
    if (token === undefined || token.length > 256) return { kind: "anonymous" };
    if (timingSafeEqual(sha256(token), this.#hostToken))
      return { kind: "host" };
    const id = this.#codes.identify(token);
    return id === undefined ? { kind: "anonymous" } : { kind: "guest", id };
  }

  /** Writes the call to the audit log and returns its outcome. */
  #record(
    tool: string,
    caller: Caller,
    outcome: Outcome,
    detail?: Record<string, string | number | boolean>,
  ): Outcome {
    this.#log.write({
      at: new Date(this.#now()).toISOString(),
      tool,
      caller: caller.kind,
      ...(caller.kind === "guest" ? { code_id: caller.id } : {}),
      outcome: outcome.ok ? "ok" : outcome.code,
      ...(detail === undefined ? {} : { detail }),
    });
    return outcome;
  }

  /** The scene, color and zone names guests may use. */
  get #names() {
    return {
      scenes: Object.keys(this.config.scenes),
      colors: Object.keys(this.config.palette),
      zones: Object.keys(this.config.zones),
    };
  }

  /**
   * Sends `parts` (zone → color, brightness) to the Bridge, one zone at a
   * time, and returns the zones it changed. For a guest it checks the freeze
   * before each zone, so a freeze while a write is pending stops the rest;
   * the host's writes ignore the freeze. `stopped` says why it stopped short.
   */
  async #apply(
    parts: readonly { zone: string; color: LightColor; brightness: number }[],
    by: "guest" | "host",
  ): Promise<{ applied: string[]; stopped?: "frozen" | "bridge" }> {
    const applied: string[] = [];
    let stopped: "frozen" | "bridge" | undefined;
    try {
      for (const { zone, color, brightness } of parts) {
        if (by === "guest" && this.policy.frozen) {
          stopped = "frozen";
          break;
        }
        const id = this.config.zones[zone];
        if (id === undefined) throw new Error(`No zone "${zone}"`);
        await this.#hue.setGroupedLight(id, {
          color,
          brightness,
          transitionMs: this.config.transitionMs,
        });
        applied.push(zone);
      }
    } catch (error) {
      stopped = "bridge";
      this.#bridge = {
        ...this.#bridge,
        lastErrorAt: new Date(this.#now()).toISOString(),
        lastError: error instanceof Error ? error.message : String(error),
      };
      console.error(`Bridge: ${this.#bridge.lastError}`);
    }
    if (stopped !== "bridge" && applied.length > 0) {
      this.#bridge = {
        ...this.#bridge,
        lastOkAt: new Date(this.#now()).toISOString(),
      };
    }
    return stopped === undefined ? { applied } : { applied, stopped };
  }

  /** The refusal for a guest change a freeze stopped, naming any zones it changed first. */
  #stoppedByFreeze(applied: readonly string[]): Outcome {
    return refuse(
      "frozen",
      applied.length === 0
        ? messages.frozen
        : `${messages.frozen} Only ${applied.join(", ")} changed before the pause.`,
    );
  }

  /** The scene's zones, each with its palette color and brightness. */
  #sceneParts(scene: string) {
    return Object.entries(this.config.scenes[scene] ?? {}).map(
      ([zone, { color, brightness }]) => {
        const entry = this.config.palette[color];
        if (entry === undefined) throw new Error(`No color "${color}"`);
        return {
          zone,
          color: "xy" in entry ? { xy: entry.xy } : { mirek: entry.mirek },
          brightness,
        };
      },
    );
  }

  /** Seconds until code `id` may change the lights again. */
  #cooldown(id: string): number {
    return this.policy.view(id, this.#now()).cooldownSeconds;
  }

  /** aux_status: the line, the holder and the caller's cooldown; the host also sees code ids and recent calls. */
  status(caller: Caller): Outcome {
    const now = this.#now();
    if (caller.kind === "anonymous") {
      return this.#record(
        "aux_status",
        caller,
        refuse("unauthorized", messages.unauthorized),
      );
    }
    const { scenes, colors, zones } = this.#names;
    if (caller.kind === "host") {
      const host = this.policy.hostView(now);
      return this.#record(
        "aux_status",
        caller,
        ok({
          ...this.#playing(),
          holder: host.holder === null ? null : "someone",
          queue_position: null,
          queue_length: host.line.length,
          turn_ends_in_seconds: host.turnEndsInSeconds,
          cooldown_seconds: 0,
          frozen: host.frozen,
          scenes,
          colors,
          zones,
          host: {
            holder_code_id: host.holder,
            line_code_ids: host.line,
            recent: this.#log.recent(),
          },
        }),
      );
    }
    const refusal = this.policy.admitStatus(caller.id, now);
    if (refusal !== undefined) {
      return this.#record(
        "aux_status",
        caller,
        refusal.code === "rate_limited"
          ? rateLimited(refusal.retryAfterSeconds)
          : refuse(refusal.code, messages[refusal.code]),
      );
    }
    const view = this.policy.view(caller.id, now);
    return this.#record(
      "aux_status",
      caller,
      ok({
        ...this.#playing(),
        holder: view.holder,
        queue_position: view.position,
        queue_length: view.waiting,
        turn_ends_in_seconds: view.turnEndsInSeconds,
        cooldown_seconds: view.cooldownSeconds,
        frozen: view.frozen,
        scenes,
        colors,
        zones,
      }),
    );
  }

  /** set_scene and host_set_scene: fades the scene's zones, within the caller's limits. */
  /** now_playing (null without music or between tracks) and, with music, up_next's slugs. */
  #playing(): Record<string, unknown> {
    const music = this.music;
    if (music === undefined) return { now_playing: null };
    const playing = music.nowPlaying;
    return {
      now_playing:
        playing === null ? null : { slug: playing.slug, title: playing.title },
      up_next: music.upNext,
    };
  }

  async setScene(caller: Caller, input: string): Promise<Outcome> {
    const tool = caller.kind === "host" ? "host_set_scene" : "set_scene";
    if (caller.kind === "anonymous") {
      return this.#record(
        tool,
        caller,
        refuse("unauthorized", messages.unauthorized),
      );
    }
    if (caller.kind === "guest" && this.policy.frozen) {
      return this.#record(tool, caller, refuse("frozen", messages.frozen));
    }
    const scene = lookup(this.config.scenes, input);
    if (scene === undefined) {
      return this.#record(
        tool,
        caller,
        refuse(
          "unknown_scene",
          `That isn't a scene here. Scenes: ${this.#names.scenes.join(", ")}.`,
        ),
      );
    }
    const now = this.#now();
    const refusal =
      caller.kind === "host"
        ? this.policy.admitHostLight(now)
        : this.policy.admitGuestLight(caller.id, now);
    if (refusal !== undefined) {
      return this.#record(
        tool,
        caller,
        refusal.code === "rate_limited"
          ? rateLimited(refusal.retryAfterSeconds)
          : refuse(refusal.code, messages[refusal.code]),
        { scene: scene.name },
      );
    }
    const parts = this.#sceneParts(scene.name);
    const { applied, stopped } = await this.#apply(parts, caller.kind);
    return this.#record(
      tool,
      caller,
      stopped === undefined
        ? ok({
            scene: scene.name,
            zones: parts.map((part) => part.zone),
            transition_seconds: this.config.transitionMs / 1000,
            ...(caller.kind === "guest"
              ? { cooldown_seconds: this.#cooldown(caller.id) }
              : {}),
          })
        : stopped === "frozen"
          ? this.#stoppedByFreeze(applied)
          : refuse("bridge_unavailable", messages.bridge_unavailable),
      stopped === "frozen"
        ? { scene: scene.name, applied_zones: applied.join(",") }
        : { scene: scene.name },
    );
  }

  /** set_color: fades one zone, the default unless named, to a palette color. */
  async setColor(
    caller: Caller,
    input: string,
    zoneInput: string | undefined,
  ): Promise<Outcome> {
    const tool = "set_color";
    if (caller.kind === "anonymous") {
      return this.#record(
        tool,
        caller,
        refuse("unauthorized", messages.unauthorized),
      );
    }
    if (caller.kind === "guest" && this.policy.frozen) {
      return this.#record(tool, caller, refuse("frozen", messages.frozen));
    }
    const color = lookup(this.config.palette, input);
    if (color === undefined) {
      return this.#record(
        tool,
        caller,
        refuse(
          "unknown_color",
          `That isn't a color here. Colors: ${this.#names.colors.join(", ")}.`,
        ),
      );
    }
    const zone = lookup(
      this.config.zones,
      zoneInput ?? this.config.defaultZone,
    );
    if (zone === undefined) {
      return this.#record(
        tool,
        caller,
        refuse(
          "unknown_zone",
          `That isn't a zone here. Zones: ${this.#names.zones.join(", ")}.`,
        ),
        { color: color.name },
      );
    }
    const detail = { color: color.name, zone: zone.name };
    const now = this.#now();
    const refusal =
      caller.kind === "host"
        ? this.policy.admitHostLight(now)
        : this.policy.admitGuestLight(caller.id, now);
    if (refusal !== undefined) {
      return this.#record(
        tool,
        caller,
        refusal.code === "rate_limited"
          ? rateLimited(refusal.retryAfterSeconds)
          : refuse(refusal.code, messages[refusal.code]),
        detail,
      );
    }
    const entry = color.value;
    const { stopped } = await this.#apply(
      [
        {
          zone: zone.name,
          color: "xy" in entry ? { xy: entry.xy } : { mirek: entry.mirek },
          brightness: entry.brightness ?? this.config.colorBrightness,
        },
      ],
      caller.kind,
    );
    return this.#record(
      tool,
      caller,
      stopped === undefined
        ? ok({
            color: color.name,
            zone: zone.name,
            transition_seconds: this.config.transitionMs / 1000,
            ...(caller.kind === "guest"
              ? { cooldown_seconds: this.#cooldown(caller.id) }
              : {}),
          })
        : stopped === "frozen"
          ? this.#stoppedByFreeze([])
          : refuse("bridge_unavailable", messages.bridge_unavailable),
      detail,
    );
  }

  /** request_aux: joins the line for a 5-minute aux turn. */
  requestAux(caller: Caller): Outcome {
    if (caller.kind !== "guest") {
      return this.#record(
        "request_aux",
        caller,
        refuse("unauthorized", messages.unauthorized),
      );
    }
    const now = this.#now();
    const result = this.policy.requestAux(caller.id, now);
    if ("code" in result) {
      return this.#record(
        "request_aux",
        caller,
        refuse("frozen", messages.frozen),
      );
    }
    const view = this.policy.view(caller.id, now);
    return this.#record(
      "request_aux",
      caller,
      ok({
        queue_position: result.position,
        queue_length: view.waiting,
        turn_ends_in_seconds: view.turnEndsInSeconds,
      }),
      { position: result.position },
    );
  }

  /** pass_aux: the holder hands the aux to the next in line, or frees it. */
  passAux(caller: Caller): Outcome {
    if (caller.kind !== "guest") {
      return this.#record(
        "pass_aux",
        caller,
        refuse("unauthorized", messages.unauthorized),
      );
    }
    const result = this.policy.passAux(caller.id, this.#now());
    if ("code" in result) {
      return this.#record(
        "pass_aux",
        caller,
        refuse(
          result.code === "not_holder" ? "not_holder" : "frozen",
          result.code === "not_holder" ? messages.not_holder : messages.frozen,
        ),
      );
    }
    return this.#record(
      "pass_aux",
      caller,
      ok({ holder: result.passed ? "someone" : null }),
    );
  }

  /** host_freeze: pauses or resumes guest control. */
  freeze(on: boolean): Outcome {
    this.policy.freeze(on);
    return this.#record("host_freeze", { kind: "host" }, ok({ frozen: on }), {
      on,
    });
  }

  /** host_clear_queue: empties the line and ends the current turn. */
  clearQueue(): Outcome {
    const cleared = this.policy.clearAux();
    return this.#record("host_clear_queue", { kind: "host" }, ok({ cleared }), {
      cleared,
    });
  }

  /** host_revoke_code: revokes the one code whose id starts with `prefix`. */
  revoke(prefix: string): Outcome {
    const result = this.#codes.revoke(prefix);
    if ("error" in result) {
      return this.#record(
        "host_revoke_code",
        { kind: "host" },
        refuse(
          result.error,
          result.error === "ambiguous_prefix"
            ? "More than one code starts with that; give more of it."
            : "No code starts with that.",
        ),
      );
    }
    this.policy.revoke(result.id, this.#now());
    this.music?.dropQueuedBy(result.id);
    return this.#record(
      "host_revoke_code",
      { kind: "host" },
      ok({ revoked_code_id: result.id }),
      { revoked_code_id: result.id },
    );
  }

  /** list_tracks: tonight's set, in play order. */
  listTracks(caller: Caller): Outcome {
    if (caller.kind === "anonymous") {
      return this.#record(
        "list_tracks",
        caller,
        refuse("unauthorized", messages.unauthorized),
      );
    }
    return this.#record(
      "list_tracks",
      caller,
      ok({
        tracks: (this.music?.tracks ?? []).map((track) => ({
          slug: track.slug,
          title: track.title,
          duration_seconds: track.durationSeconds,
        })),
      }),
    );
  }

  /** queue_track: queues a track from the set, within the caller's limits. */
  queueTrack(caller: Caller, input: string): Outcome {
    const tool = "queue_track";
    if (caller.kind === "anonymous") {
      return this.#record(
        tool,
        caller,
        refuse("unauthorized", messages.unauthorized),
      );
    }
    if (caller.kind === "guest" && this.policy.frozen) {
      return this.#record(tool, caller, refuse("frozen", messages.frozen));
    }
    const music = this.music;
    if (music === undefined) {
      return this.#record(
        tool,
        caller,
        refuse("unknown_track", messages.unknown_track),
      );
    }
    const result = music.enqueue(
      input.trim().toLowerCase(),
      caller.kind === "guest" ? caller.id : undefined,
    );
    if ("code" in result) {
      return this.#record(
        tool,
        caller,
        refuse(result.code, messages[result.code]),
      );
    }
    return this.#record(
      tool,
      caller,
      ok({
        queued: result.track.slug,
        title: result.track.title,
        position: result.position,
      }),
      { track: result.track.slug },
    );
  }

  /** skip_track: the aux holder skips once a turn; the host any time. */
  skipTrack(caller: Caller): Outcome {
    const tool = "skip_track";
    if (caller.kind === "anonymous") {
      return this.#record(
        tool,
        caller,
        refuse("unauthorized", messages.unauthorized),
      );
    }
    if (caller.kind === "guest" && this.policy.frozen) {
      return this.#record(tool, caller, refuse("frozen", messages.frozen));
    }
    let turn: string | undefined;
    if (caller.kind === "guest") {
      const holder = this.policy.holder(this.#now());
      if (holder?.id !== caller.id) {
        return this.#record(
          tool,
          caller,
          refuse("not_holder", "Only the guest holding the aux can skip."),
        );
      }
      turn = `${holder.id}:${holder.since}`;
      if (this.#skippedTurns.has(turn)) {
        return this.#record(
          tool,
          caller,
          refuse("skip_used", messages.skip_used),
        );
      }
    }
    const skipped = this.music?.skip();
    if (skipped === undefined) {
      return this.#record(
        tool,
        caller,
        refuse("nothing_playing", messages.nothing_playing),
      );
    }
    if (turn !== undefined) this.#skippedTurns.add(turn);
    return this.#record(tool, caller, ok({ skipped }), { track: skipped });
  }

  /** host_music: starts the music, or stops it after the current track is cut. */
  async setMusic(on: boolean): Promise<Outcome> {
    const music = this.music;
    if (music !== undefined) {
      if (on) music.start();
      else await music.stop();
    }
    return this.#record(
      "host_music",
      { kind: "host" },
      ok({ playing: on && music !== undefined }),
      { on },
    );
  }

  /** For `/healthz`, on the hub's own machine only. */
  health(): Record<string, unknown> {
    return {
      ok: true,
      frozen: this.policy.frozen,
      codes: this.#codes.size,
      uptime_seconds: Math.round((this.#now() - this.#started) / 1000),
      bridge: {
        last_ok_at: this.#bridge.lastOkAt ?? null,
        last_error_at: this.#bridge.lastErrorAt ?? null,
        last_error: this.#bridge.lastError ?? null,
      },
      ...(this.music === undefined
        ? {}
        : {
            music: {
              tracks: this.music.tracks.length,
              now_playing: this.music.nowPlaying?.slug ?? null,
              queued: this.music.upNext.length,
            },
          }),
    };
  }
}

/** An outcome as an MCP tool result; a refusal is an error result with the same JSON in its text. */
function toResult(outcome: Outcome): CallToolResult {
  if (outcome.ok) {
    return {
      content: [{ type: "text", text: JSON.stringify(outcome.value, null, 2) }],
      structuredContent: outcome.value,
    };
  }
  const detail = {
    code: outcome.code,
    message: outcome.message,
    ...(outcome.retryAfterSeconds === undefined
      ? {}
      : { retry_after_seconds: outcome.retryAfterSeconds }),
  };
  // The same JSON in both, as allthings aux (cli/src/aux.ts) reads either.
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(detail) }],
    structuredContent: detail,
  };
}

const nameInput = z.string().min(1).max(64);

const guestTool = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;

/** The server one request is answered by, for `caller`. */
export function buildServer(hub: Hub, caller: Caller): McpServer {
  const server = new McpServer(
    { name: "allthings-aux", version: packageJson.version },
    { maxToolInputElements: 16 },
  );

  server.registerTool(
    "aux_status",
    {
      title: "Aux status",
      description:
        "Who holds the aux, your place in line, your cooldown, whether the host has paused guest control, and the scene, color and zone names you can use. Once every 5 s per code.",
      inputSchema: z.object({}),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    () => toResult(hub.status(caller)),
  );

  server.registerTool(
    "set_scene",
    {
      title: "Set the scene",
      description:
        "Fade the room's lights to one of the host's scenes (names from aux_status). One light change per code every 30 s and 6 per 10 minutes; every 10 s while you hold the aux.",
      inputSchema: z.object({
        scene: nameInput.describe("A scene name from aux_status."),
      }),
      annotations: guestTool,
    },
    async ({ scene }) => toResult(await hub.setScene(caller, scene)),
  );

  server.registerTool(
    "set_color",
    {
      title: "Set a color",
      description:
        "Fade one zone's lights to a named palette color (names from aux_status). Shares set_scene's limits.",
      inputSchema: z.object({
        color: nameInput.describe("A color name from aux_status."),
        zone: nameInput
          .optional()
          .describe(
            "A zone name from aux_status; the host's default if left out.",
          ),
      }),
      annotations: guestTool,
    },
    async ({ color, zone }) =>
      toResult(await hub.setColor(caller, color, zone)),
  );

  server.registerTool(
    "request_aux",
    {
      title: "Request the aux",
      description:
        "Join the line to hold the aux: 5-minute turns, first come first served. queue_position 0 means you hold it now. Asking again keeps your place.",
      inputSchema: z.object({}),
      annotations: { ...guestTool, idempotentHint: true },
    },
    () => toResult(hub.requestAux(caller)),
  );

  server.registerTool(
    "pass_aux",
    {
      title: "Pass the aux",
      description: "Hand the aux to the next guest in line, if you hold it.",
      inputSchema: z.object({}),
      annotations: guestTool,
    },
    () => toResult(hub.passAux(caller)),
  );

  if (hub.music !== undefined) {
    server.registerTool(
      "list_tracks",
      {
        title: "List tracks",
        description:
          "Tonight's curated set, in play order: each track's slug, title and length. With nothing queued, the set plays in this order.",
        inputSchema: z.object({}),
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      () => toResult(hub.listTracks(caller)),
    );
    server.registerTool(
      "queue_track",
      {
        title: "Queue a track",
        description:
          "Queue a track from the set by its slug (from list_tracks). One waiting per code and two a night; the queue holds 8.",
        inputSchema: z.object({
          slug: nameInput.describe("A track slug from list_tracks."),
        }),
        annotations: guestTool,
      },
      ({ slug }) => toResult(hub.queueTrack(caller, slug)),
    );
    server.registerTool(
      "skip_track",
      {
        title: "Skip the track",
        description:
          "Skip the track playing now. Only the guest holding the aux, once a turn.",
        inputSchema: z.object({}),
        annotations: guestTool,
      },
      () => toResult(hub.skipTrack(caller)),
    );
  }

  if (caller.kind === "host") {
    if (hub.music !== undefined) {
      server.registerTool(
        "host_music",
        {
          title: "Start or stop the music",
          description:
            "on: true starts the set; on: false cuts the current track and stops.",
          inputSchema: z.object({ on: z.boolean() }),
          annotations: { ...guestTool, idempotentHint: true },
        },
        async ({ on }) => toResult(await hub.setMusic(on)),
      );
    }
    server.registerTool(
      "host_freeze",
      {
        title: "Freeze guest control",
        description:
          "on: true makes every guest tool but aux_status refuse; on: false opens them again.",
        inputSchema: z.object({ on: z.boolean() }),
        annotations: { ...guestTool, idempotentHint: true },
      },
      ({ on }) => toResult(hub.freeze(on)),
    );
    server.registerTool(
      "host_set_scene",
      {
        title: "Set the scene (host)",
        description:
          "Set a scene even while frozen, with no per-code limit. The flash guard still holds: one change every 3 s.",
        inputSchema: z.object({ scene: nameInput }),
        annotations: guestTool,
      },
      async ({ scene }) => toResult(await hub.setScene(caller, scene)),
    );
    server.registerTool(
      "host_clear_queue",
      {
        title: "Clear the aux line",
        description: "Empty the aux line and end the current turn.",
        inputSchema: z.object({}),
        annotations: { ...guestTool, destructiveHint: true },
      },
      () => toResult(hub.clearQueue()),
    );
    server.registerTool(
      "host_revoke_code",
      {
        title: "Revoke a guest code",
        description:
          "Revoke the guest code whose id (from aux_status's host view or the audit log) starts with code_hash_prefix, 6+ hex characters.",
        inputSchema: z.object({
          code_hash_prefix: z.string().min(6).max(64),
        }),
        annotations: { ...guestTool, destructiveHint: true },
      },
      ({ code_hash_prefix }) => toResult(hub.revoke(code_hash_prefix)),
    );
  }

  return server;
}

/** The largest request body read, in bytes; a tool call is far less. */
export const maxRequestBodySize = 16 * 1024;

const json = (
  status: number,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
) =>
  Response.json(body, {
    status,
    headers: { "cache-control": "no-store", ...headers },
  });

/**
 * The hub's HTTP face: `/mcp` and, on this machine only, `/healthz`.
 * `address` is the connecting socket's; behind cloudflared every request
 * comes from this machine, so the guest's address is Cloudflare's
 * `cf-connecting-ip`.
 */
export function createFetch(
  hub: Hub,
  limiter: AddressLimiter,
  { now = Date.now }: { now?: () => number } = {},
): (request: Request, address: string) => Promise<Response> {
  return async (request, address) => {
    const url = new URL(request.url);
    const viaTunnel =
      request.headers.has("cf-connecting-ip") || request.headers.has("cf-ray");

    if (url.pathname === "/healthz" && !viaTunnel) {
      return request.method === "GET"
        ? json(200, hub.health())
        : json(405, { error: "GET only" });
    }
    if (url.pathname !== "/mcp") return json(404, { error: "Not found" });

    // MCP clients and the CLI send no Origin; a browser page would.
    if (request.headers.has("origin")) {
      return json(403, { error: "Browser origins are not served" });
    }

    const wait = limiter.hit(
      request.headers.get("cf-connecting-ip") ?? address,
      now(),
    );
    if (wait > 0) {
      const seconds = Math.max(1, Math.ceil(wait / 1000));
      return json(
        429,
        { error: "Too many requests", retry_after_seconds: seconds },
        { "retry-after": String(seconds) },
      );
    }

    const length = Number(request.headers.get("content-length") ?? "0");
    if (!Number.isFinite(length) || length > maxRequestBodySize) {
      return json(413, { error: "Request body too large" });
    }

    const caller = hub.identify(request.headers.get("authorization"));
    const handler = createMcpHandler(() => buildServer(hub, caller), {
      legacy: "stateless",
      maxRequestBodySize,
    });
    return handler.fetch(request);
  };
}
