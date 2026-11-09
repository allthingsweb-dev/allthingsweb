/**
 * The hub's rules, with no I/O: every function takes the time it decides
 * for, so the tests drive the clock. The MCP tools (mcp.ts) ask here before
 * they touch a light, and the Hue client (hue.ts) checks every body it sends
 * against the flash guard once more.
 */

/** What each guest code may do, as the guest tools' contract states it. */
export const limits = {
  /** One scene or color change per code every 30 s... */
  lightIntervalMs: 30_000,
  /** ...and at most 6 in any 10 minutes. */
  lightWindowMs: 10 * 60_000,
  lightWindowMax: 6,
  /** The aux holder's cooldown, in place of both of the above. */
  holderLightIntervalMs: 10_000,
  /** aux_status, once every 5 s per code. */
  statusIntervalMs: 5_000,
  /** One turn holding the aux. */
  turnMs: 5 * 60_000,
} as const;

/**
 * The flash guard: the room's light never flashes (WCAG 2.3.1, three
 * flashes in a second, is the house rule for room light). Every change
 * fades over at least 1.5 s, the room gets at most one change every 3 s
 * from anyone (guests and host alike), brightness stays between 25% and
 * 80%, and nothing that blinks or alerts is ever sent.
 */
export const flash = {
  minTransitionMs: 1_500,
  roomIntervalMs: 3_000,
  brightnessMin: 25,
  brightnessMax: 80,
} as const;

/**
 * CLIP v2 keys that blink, pulse or animate a light: `alert` (breathe),
 * `signaling` (on_off, on_off_color, alternating), and the effect families.
 * The hub never sends any of them.
 */
export const forbiddenLightKeys = [
  "alert",
  "signaling",
  "effects",
  "effects_v2",
  "timed_effects",
] as const;

export type Refusal =
  | { readonly code: "rate_limited"; readonly retryAfterSeconds: number }
  | { readonly code: "frozen" }
  | { readonly code: "not_holder" };

const rateLimited = (waitMs: number): Refusal => ({
  code: "rate_limited",
  retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)),
});

/** A color the hub can set: CIE xy, or a white as mirek (153–500). */
export type LightColor =
  | { readonly xy: readonly [number, number] }
  | { readonly mirek: number };

/** One change to one zone's lights. */
export interface LightCommand {
  readonly color: LightColor;
  /** Percent. */
  readonly brightness: number;
  readonly transitionMs: number;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/**
 * `command` made safe: brightness within 25–80%, a fade of at least 1.5 s,
 * xy inside the chart and mirek inside Hue's range. A value that isn't a
 * finite number is refused rather than guessed.
 */
export function guardLight(command: LightCommand): LightCommand {
  const numbers = [
    command.brightness,
    command.transitionMs,
    ...("xy" in command.color ? command.color.xy : [command.color.mirek]),
  ];
  if (!numbers.every(Number.isFinite)) {
    throw new RangeError("A light command needs finite numbers");
  }
  return {
    brightness: clamp(
      Math.round(command.brightness),
      flash.brightnessMin,
      flash.brightnessMax,
    ),
    transitionMs: Math.max(
      flash.minTransitionMs,
      Math.round(command.transitionMs),
    ),
    color:
      "xy" in command.color
        ? {
            xy: [
              clamp(command.color.xy[0], 0, 1),
              clamp(command.color.xy[1], 0, 1),
            ],
          }
        : { mirek: clamp(Math.round(command.color.mirek), 153, 500) },
  };
}

/**
 * Throws unless `body`, a CLIP v2 light or grouped_light body, is safe to
 * send: no blinking or alert key, and a `dynamics.duration` of at least
 * 1.5 s. The Hue client calls it on every body, after guardLight built it.
 */
export function assertNoFlash(body: Record<string, unknown>): void {
  for (const key of forbiddenLightKeys) {
    if (key in body) throw new Error(`Refused to send "${key}" to a light`);
  }
  const dynamics = body["dynamics"];
  if (typeof dynamics !== "object" || dynamics === null) {
    throw new Error("Refused a light change without a fade");
  }
  const { duration, ...rest } = dynamics as Record<string, unknown>;
  if (typeof duration !== "number" || duration < flash.minTransitionMs) {
    throw new Error(
      `Refused a light change with a fade under ${flash.minTransitionMs} ms`,
    );
  }
  // `speed` drives an effect's animation; a fade needs only its duration.
  if (Object.keys(rest).length > 0) {
    throw new Error("Refused a light change with more than a fade's duration");
  }
}

interface CodeState {
  /** When this code changed the lights, oldest first, within the window. */
  lights: number[];
  lastStatus: number | undefined;
}

/** What a code sees of the aux, for aux_status. */
export interface AuxView {
  readonly holder: "you" | "someone" | null;
  /** 0 holds the aux, 1 is next; null is not in line. */
  readonly position: number | null;
  readonly waiting: number;
  readonly turnEndsInSeconds: number | null;
  readonly cooldownSeconds: number;
  readonly frozen: boolean;
}

/**
 * Who may change the lights, and when: per-code limits, the aux line
 * (FIFO, 5-minute turns), the host's freeze and the room's flash interval.
 * Its state lives in memory; a restart starts a fresh line.
 */
export class Policy {
  readonly #codes = new Map<string, CodeState>();
  #holder: { id: string; since: number } | undefined;
  #line: string[] = [];
  #frozen: boolean;
  #lastRoomChange = Number.NEGATIVE_INFINITY;

  constructor({ frozen = true }: { frozen?: boolean } = {}) {
    this.#frozen = frozen;
  }

  /** Whether guest control is paused. */
  get frozen(): boolean {
    return this.#frozen;
  }

  /** Pauses (`on`) or resumes guest control. */
  freeze(on: boolean): void {
    this.#frozen = on;
  }

  /** Code `id`'s state, created on first use. */
  #state(id: string): CodeState {
    let state = this.#codes.get(id);
    if (state === undefined) {
      state = { lights: [], lastStatus: undefined };
      this.#codes.set(id, state);
    }
    return state;
  }

  /** Hands the aux on for every turn that ended by `now`. */
  #advance(now: number): void {
    while (
      this.#holder !== undefined &&
      now >= this.#holder.since + limits.turnMs
    ) {
      const end = this.#holder.since + limits.turnMs;
      const next = this.#line.shift();
      this.#holder = next === undefined ? undefined : { id: next, since: end };
    }
  }

  /** Whether code `id` holds the aux now. */
  #isHolder(id: string): boolean {
    return this.#holder?.id === id;
  }

  /** How long `id` must wait to change the lights, in ms (0: now). */
  #codeWait(id: string, now: number): number {
    const state = this.#codes.get(id);
    if (state === undefined) return 0;
    state.lights = state.lights.filter(
      (time) => now - time < limits.lightWindowMs,
    );
    const last = state.lights.at(-1);
    if (this.#isHolder(id)) {
      return last === undefined
        ? 0
        : Math.max(0, last + limits.holderLightIntervalMs - now);
    }
    let wait = last === undefined ? 0 : last + limits.lightIntervalMs - now;
    if (state.lights.length >= limits.lightWindowMax) {
      const oldest = state.lights[state.lights.length - limits.lightWindowMax];
      if (oldest !== undefined) {
        wait = Math.max(wait, oldest + limits.lightWindowMs - now);
      }
    }
    return Math.max(0, wait);
  }

  /** How long the room's flash guard holds any change, in ms (0: now). */
  #roomWait(now: number): number {
    return Math.max(0, this.#lastRoomChange + flash.roomIntervalMs - now);
  }

  /**
   * Whether guest `id` may change the lights at `now`. When it may, the
   * change is counted against the code and the room at once, so a call
   * that fails at the Bridge still counts: the lights may have changed.
   */
  admitGuestLight(id: string, now: number): Refusal | undefined {
    if (this.#frozen) return { code: "frozen" };
    this.#advance(now);
    const wait = Math.max(this.#codeWait(id, now), this.#roomWait(now));
    if (wait > 0) return rateLimited(wait);
    this.#state(id).lights.push(now);
    this.#lastRoomChange = now;
    return undefined;
  }

  /** The host isn't limited per code or by the freeze, only by the flash guard. */
  admitHostLight(now: number): Refusal | undefined {
    const wait = this.#roomWait(now);
    if (wait > 0) return rateLimited(wait);
    this.#lastRoomChange = now;
    return undefined;
  }

  /** Whether guest `id` may read the status at `now`; counts it if so. */
  admitStatus(id: string, now: number): Refusal | undefined {
    const state = this.#state(id);
    if (
      state.lastStatus !== undefined &&
      now - state.lastStatus < limits.statusIntervalMs
    ) {
      return rateLimited(state.lastStatus + limits.statusIntervalMs - now);
    }
    state.lastStatus = now;
    return undefined;
  }

  /**
   * Puts `id` in the aux line, or hands it the aux when nobody holds it.
   * Asking again keeps its place. Position 0 holds the aux.
   */
  requestAux(id: string, now: number): { position: number } | Refusal {
    if (this.#frozen) return { code: "frozen" };
    this.#advance(now);
    if (this.#isHolder(id)) return { position: 0 };
    const index = this.#line.indexOf(id);
    if (index !== -1) return { position: index + 1 };
    if (this.#holder === undefined) {
      this.#holder = { id, since: now };
      return { position: 0 };
    }
    this.#line.push(id);
    return { position: this.#line.length };
  }

  /** The holder hands the aux to the next in line, or frees it. */
  passAux(id: string, now: number): { passed: boolean } | Refusal {
    if (this.#frozen) return { code: "frozen" };
    this.#advance(now);
    if (!this.#isHolder(id)) return { code: "not_holder" };
    const next = this.#line.shift();
    this.#holder = next === undefined ? undefined : { id: next, since: now };
    return { passed: next !== undefined };
  }

  /** Empties the line and ends the current turn. Returns who was in it. */
  clearAux(): number {
    const count = this.#line.length + (this.#holder === undefined ? 0 : 1);
    this.#line = [];
    this.#holder = undefined;
    return count;
  }

  /** Takes a revoked code out of the line, handing the aux on if it held it. */
  revoke(id: string, now: number): void {
    this.#line = this.#line.filter((queued) => queued !== id);
    if (this.#isHolder(id)) {
      const next = this.#line.shift();
      this.#holder = next === undefined ? undefined : { id: next, since: now };
    }
    this.#codes.delete(id);
  }

  /** What guest `id` sees at `now`: the holder, its place in line and its cooldown. */
  view(id: string, now: number): AuxView {
    this.#advance(now);
    const index = this.#line.indexOf(id);
    return {
      holder:
        this.#holder === undefined
          ? null
          : this.#isHolder(id)
            ? "you"
            : "someone",
      position: this.#isHolder(id) ? 0 : index === -1 ? null : index + 1,
      waiting: this.#line.length,
      turnEndsInSeconds:
        this.#holder === undefined
          ? null
          : Math.ceil((this.#holder.since + limits.turnMs - now) / 1000),
      cooldownSeconds: Math.ceil(this.#codeWait(id, now) / 1000),
      frozen: this.#frozen,
    };
  }

  /** The host's view: who holds the aux and who waits, by code id. */
  hostView(now: number): {
    holder: string | null;
    line: readonly string[];
    turnEndsInSeconds: number | null;
    frozen: boolean;
  } {
    this.#advance(now);
    return {
      holder: this.#holder?.id ?? null,
      line: [...this.#line],
      turnEndsInSeconds:
        this.#holder === undefined
          ? null
          : Math.ceil((this.#holder.since + limits.turnMs - now) / 1000),
      frozen: this.#frozen,
    };
  }
}

/**
 * The second guard, in front of authentication: at most `max` requests per
 * address in each fixed window. Guests on the venue's Wi-Fi may share one
 * address, so it is set far above any one code's limits; it stops a
 * runaway script, not a guest.
 */
export class AddressLimiter {
  readonly #windows = new Map<string, { start: number; count: number }>();
  readonly max: number;
  readonly windowMs: number;

  constructor(max: number, windowMs = 60_000) {
    this.max = max;
    this.windowMs = windowMs;
  }

  /** Counts a request from `address`; returns how long to wait (0: go). */
  hit(address: string, now: number): number {
    if (this.#windows.size > 10_000) {
      for (const [key, window] of this.#windows) {
        if (now - window.start >= this.windowMs) this.#windows.delete(key);
      }
    }
    const window = this.#windows.get(address);
    if (window === undefined || now - window.start >= this.windowMs) {
      this.#windows.set(address, { start: now, count: 1 });
      return 0;
    }
    if (window.count >= this.max) return window.start + this.windowMs - now;
    window.count += 1;
    return 0;
  }
}
