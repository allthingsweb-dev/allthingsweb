import type { Track } from "./catalog.ts";

/**
 * The hub's music: the prefetched curated set (catalog.ts), played one track
 * at a time at the volume ceiling the host agreed with the venue. Guests
 * queue tracks from the set; with nothing queued, the set plays in its
 * configured order, round again. Guests can't change the volume, and
 * nothing outside the set ever plays.
 */

/** What each guest code may do with the music, as the tools' contract states it. */
export const musicLimits = {
  /** Tracks one code may have waiting at once. */
  pendingPerCode: 1,
  /** Tracks one code may queue in a night. */
  perCodePerNight: 2,
  /** The longest the queue grows. */
  queueMax: 8,
} as const;

export type QueueRefusal =
  | { readonly code: "unknown_track" }
  | { readonly code: "queue_full" }
  | { readonly code: "already_queued" }
  | { readonly code: "night_limit" };

/** A running player process: its exit, and a way to stop it. */
export interface PlayProcess {
  readonly exited: Promise<number>;
  kill(): void;
}

/** Starts playing `file` at `volume` (0 to 1). */
export type Spawn = (file: string, volume: number) => PlayProcess;

/** The players the hub can drive: macOS's afplay, or mpv or PipeWire's pw-play on Linux. */
export const playerNames = ["afplay", "mpv", "pw-play"] as const;
export type PlayerName = (typeof playerNames)[number];

/**
 * The command line that plays `file` once at `volume` (0 to 1) and exits.
 * Each player takes the ceiling in its own scale; killing it stops the track.
 */
export function playerCommand(
  player: PlayerName,
  file: string,
  volume: number,
): string[] {
  switch (player) {
    case "afplay":
      return ["afplay", "-v", String(volume), file];
    case "mpv":
      // mpv's --volume is a percentage; 100 is the file's own level.
      return [
        "mpv",
        "--no-video",
        "--no-terminal",
        `--volume=${Math.round(volume * 100)}`,
        file,
      ];
    case "pw-play":
      return ["pw-play", `--volume=${volume}`, file];
    default: {
      const unknown: never = player;
      throw new Error(`Unknown music player: ${String(unknown)}`);
    }
  }
}

/** A Spawn that runs `player` for each track. */
export function spawnPlayer(player: PlayerName): Spawn {
  return (file, volume) => {
    const child = Bun.spawn(playerCommand(player, file, volume), {
      stdout: "ignore",
      stderr: "ignore",
    });
    return { exited: child.exited, kill: () => child.kill() };
  };
}

/** macOS's afplay: `-v` sets the volume, and killing it stops the track. */
export const afplay: Spawn = spawnPlayer("afplay");

/**
 * The player for this machine: the configured one if it's installed, else
 * afplay on macOS, else the first of mpv and pw-play on Linux. `which`
 * finds a command on PATH, as Bun.which does.
 */
export function choosePlayer(
  platform: string,
  which: (command: string) => string | null,
  configured?: PlayerName,
): { player: PlayerName } | { error: string } {
  if (configured !== undefined) {
    return which(configured) === null
      ? { error: `music.player is ${configured}, which isn't installed here` }
      : { player: configured };
  }
  const candidates: readonly PlayerName[] =
    platform === "darwin"
      ? ["afplay"]
      : platform === "linux"
        ? ["mpv", "pw-play"]
        : [];
  for (const candidate of candidates) {
    if (which(candidate) !== null) return { player: candidate };
  }
  return {
    error:
      platform === "linux"
        ? "no player found: install mpv (sudo apt install mpv) or PipeWire's pw-play"
        : platform === "darwin"
          ? "afplay isn't on PATH"
          : `no player is known for ${platform}; run the hub on macOS or Linux`,
  };
}

interface Entry {
  readonly track: Track;
  /** The guest code id that queued it; undefined for the host or the set. */
  readonly by: string | undefined;
  readonly from: "set" | "queue";
}

/** The track playing now, and who chose it. */
export interface NowPlaying {
  readonly slug: string;
  readonly title: string;
  readonly from: "set" | "queue";
}

/**
 * The queue and the player. Its state lives in memory; a restart starts with
 * an empty queue and fresh per-code counts.
 */
export class Music {
  readonly #tracks: ReadonlyMap<string, Track>;
  readonly #order: readonly Track[];
  readonly #volume: number;
  readonly #spawn: Spawn;
  readonly #onError: (message: string) => void;
  readonly #failed = new Set<string>();
  readonly #queuedTonight = new Map<string, number>();
  #queue: Entry[] = [];
  #next = 0;
  #current:
    | { readonly entry: Entry; readonly process: PlayProcess }
    | undefined;
  #loop: Promise<void> = Promise.resolve();
  #running = false;
  /** Bumped by every start and stop; a loop whose generation is old exits. */
  #generation = 0;

  constructor({
    tracks,
    volume,
    spawn = afplay,
    onError = (message) => console.error(`Music: ${message}`),
  }: {
    tracks: readonly Track[];
    volume: number;
    spawn?: Spawn;
    onError?: (message: string) => void;
  }) {
    if (!(volume >= 0 && volume <= 1)) {
      throw new Error(`The music volume must be 0 to 1, not ${volume}`);
    }
    this.#order = tracks;
    this.#tracks = new Map(tracks.map((track) => [track.slug, track]));
    this.#volume = volume;
    this.#spawn = spawn;
    this.#onError = onError;
  }

  /** The set guests choose from, in play order, without tracks that failed. */
  get tracks(): readonly Track[] {
    return this.#order.filter((track) => !this.#failed.has(track.slug));
  }

  /** What's playing, or null between tracks and when stopped. */
  get nowPlaying(): NowPlaying | null {
    const current = this.#current;
    if (current === undefined) return null;
    return {
      slug: current.entry.track.slug,
      title: current.entry.track.title,
      from: current.entry.from,
    };
  }

  /** The queued tracks' slugs, next first. */
  get upNext(): readonly string[] {
    return this.#queue.map((entry) => entry.track.slug);
  }

  /**
   * Queues the set's track `slug`. A guest (`by`, its code id) may have one
   * waiting and queue two a night; the host (`by` undefined) only meets the
   * queue's cap. Returns the track's place: 1 plays next.
   */
  enqueue(
    slug: string,
    by: string | undefined,
  ): { position: number; track: Track } | QueueRefusal {
    const track = this.#tracks.get(slug);
    if (track === undefined || this.#failed.has(slug)) {
      return { code: "unknown_track" };
    }
    if (this.#queue.length >= musicLimits.queueMax) {
      return { code: "queue_full" };
    }
    if (by !== undefined) {
      const waiting = this.#queue.filter((entry) => entry.by === by).length;
      if (waiting >= musicLimits.pendingPerCode) {
        return { code: "already_queued" };
      }
      if ((this.#queuedTonight.get(by) ?? 0) >= musicLimits.perCodePerNight) {
        return { code: "night_limit" };
      }
      this.#queuedTonight.set(by, (this.#queuedTonight.get(by) ?? 0) + 1);
    }
    this.#queue.push({ track, by, from: "queue" });
    return { position: this.#queue.length, track };
  }

  /**
   * Stops the current track, so the next one starts. Returns its slug, or
   * undefined when nothing is playing, as when a skip already stopped it.
   */
  skip(): string | undefined {
    const current = this.#current;
    if (current === undefined) return undefined;
    this.#current = undefined;
    current.process.kill();
    return current.entry.track.slug;
  }

  /** Drops a revoked code's waiting tracks. */
  dropQueuedBy(by: string): void {
    this.#queue = this.#queue.filter((entry) => entry.by !== by);
  }

  /**
   * Starts playing, if it isn't already. A start during a stop waits for the
   * old loop to end, so only one loop ever plays.
   */
  start(): void {
    if (this.#running) return;
    // With every track out, a host start retries the whole set; with some
    // still playable, the failed ones stay out for the night.
    if (this.#failed.size >= this.#order.length) this.#failed.clear();
    this.#running = true;
    const generation = ++this.#generation;
    this.#loop = this.#loop.then(() => this.#play(generation));
  }

  /** Stops the current track and the player, and waits for it to end. */
  async stop(): Promise<void> {
    this.#running = false;
    this.#generation++;
    this.skip();
    await this.#loop;
  }

  /** The next entry: the queue first, else the set's next playable track. */
  #take(): Entry | undefined {
    const queued = this.#queue.shift();
    if (queued !== undefined) return queued;
    if (this.#failed.size >= this.#order.length) return undefined;
    for (let tried = 0; tried < this.#order.length; tried++) {
      const track = this.#order[this.#next % this.#order.length];
      this.#next = (this.#next + 1) % this.#order.length;
      if (track !== undefined && !this.#failed.has(track.slug)) {
        return { track, by: undefined, from: "set" };
      }
    }
    return undefined;
  }

  /** Plays entries one after another until stopped or nothing is playable. */
  async #play(generation: number): Promise<void> {
    while (this.#running && generation === this.#generation) {
      const entry = this.#take();
      if (entry === undefined) {
        this.#onError("no playable tracks left; the music has stopped");
        this.#running = false;
        return;
      }
      let process: PlayProcess;
      try {
        process = this.#spawn(entry.track.file, this.#volume);
      } catch (error) {
        this.#fail(entry.track, error);
        continue;
      }
      this.#current = { entry, process };
      const code = await process.exited;
      const skipped = this.#current?.process !== process;
      if (!skipped) this.#current = undefined;
      // A track that ends badly by itself won't play again tonight.
      if (!skipped && code !== 0) this.#fail(entry.track, `exit code ${code}`);
    }
  }

  /** Takes `track` out of the set for the night, and says why. */
  #fail(track: Track, reason: unknown): void {
    this.#failed.add(track.slug);
    this.#queue = this.#queue.filter((entry) => entry.track !== track);
    this.#onError(
      `${track.slug} didn't play (${reason instanceof Error ? reason.message : String(reason)}); it's out of the set tonight`,
    );
  }
}
