import { afterAll, describe, expect, test } from "bun:test";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  type CatalogFetch,
  loadPlaylist,
  manifestName,
  prefetch,
  readCatalog,
} from "../src/catalog.ts";

const directory = mkdtempSync(join(import.meta.dir, ".tmp-catalog-"));
afterAll(() => rmSync(directory, { recursive: true, force: true }));

const base = "https://mus.ax";

/** mus.ax's API over `count` songs, counting the requests it answers. */
function fakeMusAx(
  count: number,
  audio: (slug: string) => Response = (slug) =>
    new Response(`mp3 bytes of ${slug}`, {
      headers: { "content-type": "audio/mpeg" },
    }),
) {
  const songs = Array.from({ length: count }, (_, i) => ({
    slug: `song-${i}`,
    title: `Song ${i}`,
    duration_seconds: 180 + i,
    audio_url: `/audio/song-${i}.mp3`,
  }));
  const requests: string[] = [];
  const fetch: CatalogFetch = async (input) => {
    const url = new URL(String(input));
    requests.push(url.pathname + url.search);
    if (url.pathname === "/api/catalog") {
      const limit = Math.min(Number(url.searchParams.get("limit")), 100);
      const offset = Number(url.searchParams.get("offset"));
      return Response.json({
        songs: songs.slice(offset, offset + limit),
        total: songs.length,
        limit,
        offset,
      });
    }
    const match = /^\/audio\/(.+)\.mp3$/.exec(url.pathname);
    return match?.[1] === undefined
      ? new Response("Not found", { status: 404 })
      : audio(match[1]);
  };
  return { fetch, requests };
}

describe("the mus.ax catalog", () => {
  test("is read page by page, 100 songs at a time", async () => {
    const { fetch, requests } = fakeMusAx(150);
    const songs = await readCatalog(base, fetch);
    expect(songs).toHaveLength(150);
    expect(songs[149]).toMatchObject({ slug: "song-149", title: "Song 149" });
    expect(requests).toEqual([
      "/api/catalog?limit=100&offset=0",
      "/api/catalog?limit=100&offset=100",
    ]);
  });

  test("an unexpected answer is an error, not an empty set", async () => {
    const broken: CatalogFetch = async () => Response.json({ items: [] });
    await expect(readCatalog(base, broken)).rejects.toThrow("unexpected shape");
    const down: CatalogFetch = async () => new Response("", { status: 503 });
    await expect(readCatalog(base, down)).rejects.toThrow("answered 503");
  });
});

describe("prefetch", () => {
  test("saves each track and a manifest, then keeps what's unchanged", async () => {
    const dir = join(directory, "saved");
    const { fetch, requests } = fakeMusAx(3);
    const slugs = ["song-2", "song-0"];
    expect(await prefetch({ base, slugs, dir, fetch })).toEqual({
      saved: ["song-2", "song-0"],
      kept: [],
      failed: [],
    });
    expect(readFileSync(join(dir, "song-2.mp3"), "utf8")).toBe(
      "mp3 bytes of song-2",
    );
    const manifest = JSON.parse(readFileSync(join(dir, manifestName), "utf8"));
    expect(
      manifest.tracks.map((entry: { slug: string }) => entry.slug),
    ).toEqual(slugs);
    expect(manifest.tracks[0]).toMatchObject({
      title: "Song 2",
      duration_seconds: 182,
      bytes: "mp3 bytes of song-2".length,
    });

    requests.length = 0;
    expect(await prefetch({ base, slugs, dir, fetch })).toEqual({
      saved: [],
      kept: ["song-2", "song-0"],
      failed: [],
    });
    expect(requests.some((path) => path.startsWith("/audio/"))).toBe(false);

    // A file that changed on disk is fetched again.
    writeFileSync(join(dir, "song-0.mp3"), "something else");
    expect(await prefetch({ base, slugs, dir, fetch })).toMatchObject({
      saved: ["song-0"],
      kept: ["song-2"],
    });
  });

  test("reports each track that didn't arrive, and saves the rest", async () => {
    const dir = join(directory, "failures");
    const { fetch } = fakeMusAx(4, (slug) => {
      if (slug === "song-1") return new Response("gone", { status: 404 });
      if (slug === "song-2") {
        return new Response("<html>", {
          headers: { "content-type": "text/html" },
        });
      }
      if (slug === "song-3") {
        return new Response("x".repeat(64), {
          headers: { "content-type": "audio/mpeg" },
        });
      }
      return new Response("ok", { headers: { "content-type": "audio/mpeg" } });
    });
    const result = await prefetch({
      base,
      slugs: ["song-0", "song-1", "song-2", "song-3", "not-on-musax"],
      dir,
      fetch,
      maxBytes: 32,
    });
    expect(result.saved).toEqual(["song-0"]);
    expect(result.failed).toEqual([
      { slug: "song-1", error: "answered 404" },
      { slug: "song-2", error: "is text/html, not audio/mpeg" },
      { slug: "song-3", error: "is over 32 bytes" },
      { slug: "not-on-musax", error: "not in mus.ax's catalog" },
    ]);
    expect(readdirSync(dir).toSorted()).toEqual(["song-0.mp3", manifestName]);
  });
});

describe("the playlist", () => {
  test("holds the configured tracks the disk has at their recorded size, in order", async () => {
    const dir = join(directory, "playlist");
    const { fetch } = fakeMusAx(3);
    await prefetch({ base, slugs: ["song-0", "song-1", "song-2"], dir, fetch });
    writeFileSync(join(dir, "song-1.mp3"), "truncated");
    rmSync(join(dir, "song-2.mp3"));
    const { tracks, missing } = loadPlaylist(dir, [
      "song-2",
      "song-0",
      "song-1",
      "never-fetched",
    ]);
    expect(tracks).toEqual([
      {
        slug: "song-0",
        title: "Song 0",
        file: join(dir, "song-0.mp3"),
        durationSeconds: 180,
      },
    ]);
    expect(missing).toEqual(["song-2", "song-1", "never-fetched"]);
  });

  test("is empty before any prefetch", () => {
    expect(loadPlaylist(join(directory, "nothing"), ["song-0"])).toEqual({
      tracks: [],
      missing: ["song-0"],
    });
  });
});
