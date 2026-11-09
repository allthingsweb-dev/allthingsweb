import { describe, expect, test } from "bun:test";
import {
  choosePlayer,
  Music,
  musicLimits,
  mpvVolume,
  playerCommand,
  playerEnv,
} from "../src/music.ts";
import { fakeSpawn, settle, track } from "./support.ts";

/** A player over `slugs`, with its fake processes and the errors it reported. */
function player(slugs: string[] = ["a", "b"]) {
  const { spawn, started } = fakeSpawn();
  const errors: string[] = [];
  const music = new Music({
    tracks: slugs.map(track),
    volume: 0.6,
    spawn,
    onError: (message) => errors.push(message),
  });
  return { music, started, errors };
}

describe("music", () => {
  test("plays the set in order, round again, at the volume ceiling", async () => {
    const { music, started } = player();
    music.start();
    await settle();
    expect(started.map(({ file, volume }) => [file, volume])).toEqual([
      ["/music/a.mp3", 0.6],
    ]);
    expect(music.nowPlaying).toEqual({
      slug: "a",
      title: "Title of a",
      from: "set",
    });
    started[0]?.finish();
    await settle();
    started[1]?.finish();
    await settle();
    expect(started.map((run) => run.file)).toEqual([
      "/music/a.mp3",
      "/music/b.mp3",
      "/music/a.mp3",
    ]);
    await music.stop();
  });

  test("queued tracks play next, then the set carries on", async () => {
    const { music, started } = player(["a", "b", "c"]);
    music.start();
    await settle();
    expect(music.enqueue("c", "code-1")).toMatchObject({ position: 1 });
    expect(music.upNext).toEqual(["c"]);
    started[0]?.finish();
    await settle();
    expect(music.nowPlaying).toMatchObject({ slug: "c", from: "queue" });
    started[1]?.finish();
    await settle();
    expect(music.nowPlaying).toMatchObject({ slug: "b", from: "set" });
    await music.stop();
  });

  test("a guest has one track waiting and two a night; the queue holds 8", async () => {
    const { music } = player(["a", "b", "c"]);
    expect(music.enqueue("nope", "code-1")).toEqual({ code: "unknown_track" });
    expect(music.enqueue("a", "code-1")).toMatchObject({ position: 1 });
    expect(music.enqueue("b", "code-1")).toEqual({ code: "already_queued" });
    // The host meets only the cap.
    for (let i = 2; i <= musicLimits.queueMax; i++) {
      expect(music.enqueue("b", undefined)).toMatchObject({ position: i });
    }
    expect(music.enqueue("c", undefined)).toEqual({ code: "queue_full" });
    expect(music.enqueue("c", "code-2")).toEqual({ code: "queue_full" });

    // Once code-1's track plays, the queue has room and code-1 its second.
    music.start();
    await settle();
    expect(music.nowPlaying).toMatchObject({ slug: "a", from: "queue" });
    expect(music.enqueue("b", "code-1")).toMatchObject({ position: 8 });
    await music.stop();

    const fresh = player(["a", "b", "c"]);
    expect(fresh.music.enqueue("a", "code-1")).toMatchObject({ position: 1 });
    fresh.music.start();
    await settle();
    expect(fresh.music.enqueue("b", "code-1")).toMatchObject({ position: 1 });
    fresh.started[0]?.finish();
    await settle();
    expect(fresh.music.enqueue("c", "code-1")).toEqual({ code: "night_limit" });
    await fresh.music.stop();
  });

  test("skip cuts the track and the next starts; a second skip finds nothing", async () => {
    const { music, started } = player();
    music.start();
    await settle();
    expect(music.skip()).toBe("a");
    expect(music.skip()).toBeUndefined();
    expect(started[0]?.killed).toBe(true);
    await settle();
    expect(started.map((run) => run.file)).toEqual([
      "/music/a.mp3",
      "/music/b.mp3",
    ]);
    expect(music.nowPlaying).toMatchObject({ slug: "b" });
    await music.stop();
  });

  test("a track that fails is out for the night, and the rest play on", async () => {
    const { music, started, errors } = player();
    music.start();
    await settle();
    started[0]?.finish(1);
    await settle();
    expect(errors).toEqual([
      "a didn't play (exit code 1); it's out of the set tonight",
    ]);
    started[1]?.finish();
    await settle();
    expect(started.map((run) => run.file)).toEqual([
      "/music/a.mp3",
      "/music/b.mp3",
      "/music/b.mp3",
    ]);
    expect(music.tracks.map((entry) => entry.slug)).toEqual(["b"]);
    expect(music.enqueue("a", "code-1")).toEqual({ code: "unknown_track" });
    await music.stop();
  });

  test("stops when no track can play", async () => {
    const { music, started, errors } = player(["a"]);
    music.start();
    await settle();
    started[0]?.finish(1);
    await settle();
    expect(errors.at(-1)).toBe(
      "no playable tracks left; the music has stopped",
    );
    expect(music.nowPlaying).toBeNull();
    expect(started).toHaveLength(1);
  });

  test("a start after every track failed retries the set; a partial failure stays out", async () => {
    const { music, started } = player(["a", "b"]);
    music.start();
    await settle();
    started[0]?.finish(1);
    await settle();
    started[1]?.finish(1);
    await settle();
    expect(music.tracks).toEqual([]);
    expect(music.nowPlaying).toBeNull();
    music.start();
    await settle();
    expect(music.tracks.map((entry) => entry.slug)).toEqual(["a", "b"]);
    expect(music.nowPlaying).toMatchObject({ slug: "a" });
    // a fails again but b plays: stop and start keep a out.
    started[2]?.finish(1);
    await settle();
    await music.stop();
    music.start();
    await settle();
    expect(music.tracks.map((entry) => entry.slug)).toEqual(["b"]);
    await music.stop();
  });

  test("stop cuts the track and ends the loop", async () => {
    const { music, started } = player();
    music.start();
    music.start();
    await settle();
    await music.stop();
    await settle();
    expect(started).toHaveLength(1);
    expect(started[0]?.killed).toBe(true);
    expect(music.nowPlaying).toBeNull();
  });

  test("a start during a stop waits for the old loop, so only one plays", async () => {
    const { music, started } = player(["a", "b", "c"]);
    music.start();
    await settle();
    const stopping = music.stop();
    music.start();
    await stopping;
    await settle();
    expect(started.map((run) => [run.file, run.killed])).toEqual([
      ["/music/a.mp3", true],
      ["/music/b.mp3", false],
    ]);
    started[1]?.finish();
    await settle();
    // One loop moves on to one next track, not two.
    expect(started.map((run) => run.file)).toEqual([
      "/music/a.mp3",
      "/music/b.mp3",
      "/music/c.mp3",
    ]);
    await music.stop();
  });

  test("the volume ceiling is 0 to 1", () => {
    expect(
      () =>
        new Music({
          tracks: [track("a")],
          volume: 1.5,
          spawn: fakeSpawn().spawn,
        }),
    ).toThrow("must be 0 to 1");
  });
});

describe("players", () => {
  test("each player gets the volume ceiling in its own scale", () => {
    expect(playerCommand("afplay", "/m/a.mp3", 0.6)).toEqual([
      "afplay",
      "-v",
      "0.6",
      "/m/a.mp3",
    ]);
    expect(playerCommand("mpv", "/m/a.mp3", 0.6)).toEqual([
      "mpv",
      "--no-video",
      "--no-terminal",
      "--volume=60",
      "/m/a.mp3",
    ]);
    expect(playerCommand("pw-play", "/m/a.mp3", 0.6)).toEqual([
      "pw-play",
      "--volume=0.6",
      "/m/a.mp3",
    ]);
  });

  test("mpv's percentage never passes a fractional ceiling", () => {
    expect(mpvVolume(0.995)).toBe("99.5");
    expect(mpvVolume(0.99999)).toBe("99.99");
    expect(mpvVolume(0.57)).toBe("57");
    expect(mpvVolume(1)).toBe("100");
    expect(mpvVolume(0)).toBe("0");
    expect(playerCommand("mpv", "/m/a.mp3", 0.995)).toContain("--volume=99.5");
  });

  test("pw-play runs in the C locale, and the others inherit theirs", () => {
    expect(playerEnv("pw-play")).toEqual({ LC_ALL: "C" });
    expect(playerEnv("mpv")).toBeUndefined();
    expect(playerEnv("afplay")).toBeUndefined();
  });

  const installed =
    (...commands: string[]) =>
    (command: string) =>
      commands.includes(command) ? `/usr/bin/${command}` : null;

  test("macOS plays through afplay", () => {
    expect(choosePlayer("darwin", installed("afplay"))).toEqual({
      player: "afplay",
    });
  });

  test("Linux prefers mpv, then pw-play", () => {
    expect(choosePlayer("linux", installed("mpv", "pw-play"))).toEqual({
      player: "mpv",
    });
    expect(choosePlayer("linux", installed("pw-play"))).toEqual({
      player: "pw-play",
    });
  });

  test("Linux without a player says what to install", () => {
    const chosen = choosePlayer("linux", installed());
    expect("error" in chosen && chosen.error).toContain("sudo apt install mpv");
  });

  test("a configured player wins, but only if it's installed", () => {
    expect(
      choosePlayer("linux", installed("mpv", "pw-play"), "pw-play"),
    ).toEqual({ player: "pw-play" });
    expect(choosePlayer("linux", installed("mpv"), "afplay")).toEqual({
      error: "music.player is afplay, which isn't installed here",
    });
  });

  test("another platform gets no player", () => {
    expect(choosePlayer("win32", installed("mpv"))).toEqual({
      error: "no player is known for win32; run the hub on macOS or Linux",
    });
  });
});
