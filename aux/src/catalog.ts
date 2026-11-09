import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { z } from "zod";

/**
 * The curated set, from mus.ax's public API: `/api/catalog` lists songs up
 * to 100 at a time, and `/audio/<slug>.mp3` serves each one. `--prefetch`
 * saves the configured tracks in the cache directory with a manifest, so
 * the night never streams. The hub plays only what the manifest lists and
 * the disk holds, at the size the manifest recorded.
 */

/** A mus.ax slug: it names the file on disk, so nothing else gets through. */
export const slugPattern = /^[a-z0-9][a-z0-9-]{0,99}$/;

/** The largest MP3 the prefetch keeps; mus.ax's tracks are under 15 MB. */
export const maxTrackBytes = 50 * 1024 * 1024;

/** The manifest's name inside the cache directory. */
export const manifestName = "tracks.json";

const pageSize = 100;
const requestTimeoutMs = 30_000;
/** One track's download, fetch and body read together: a 15 MB file on slow venue Wi-Fi. */
const audioTimeoutMs = 5 * 60_000;

const songSchema = z.object({
  slug: z.string(),
  title: z.string(),
  duration_seconds: z.number().nonnegative().nullable().optional(),
});

const catalogPageSchema = z.object({
  songs: z.array(songSchema),
  total: z.number().int().nonnegative(),
});

export type CatalogSong = z.infer<typeof songSchema>;

const manifestSchema = z.object({
  version: z.literal(1),
  tracks: z.array(
    z.object({
      slug: z.string().regex(slugPattern),
      title: z.string(),
      duration_seconds: z.number().nonnegative().nullable(),
      bytes: z.number().int().positive(),
      sha256: z.string().regex(/^[0-9a-f]{64}$/),
    }),
  ),
});

type Manifest = z.infer<typeof manifestSchema>;
type ManifestTrack = Manifest["tracks"][number];

/** A track ready to play: its file on disk and what guests see. */
export interface Track {
  readonly slug: string;
  readonly title: string;
  readonly file: string;
  readonly durationSeconds: number | null;
}

export type CatalogFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

/** Every song in mus.ax's catalog, page by page. */
export async function readCatalog(
  base: string,
  fetch: CatalogFetch = globalThis.fetch,
): Promise<CatalogSong[]> {
  const songs: CatalogSong[] = [];
  for (;;) {
    const url = new URL("/api/catalog", base);
    url.searchParams.set("limit", String(pageSize));
    url.searchParams.set("offset", String(songs.length));
    const response = await fetch(url, {
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
    if (!response.ok) {
      throw new Error(`mus.ax's catalog answered ${response.status}`);
    }
    const page = catalogPageSchema.safeParse(await response.json());
    if (!page.success) {
      throw new Error(
        `mus.ax's catalog has an unexpected shape: ${page.error.message}`,
      );
    }
    songs.push(...page.data.songs);
    if (page.data.songs.length === 0 || songs.length >= page.data.total) {
      return songs;
    }
  }
}

/** The manifest in `dir`, or an empty one when there is none yet. */
function readManifest(dir: string): Manifest {
  const path = join(dir, manifestName);
  if (!existsSync(path)) return { version: 1, tracks: [] };
  const parsed = manifestSchema.safeParse(
    JSON.parse(readFileSync(path, "utf8")),
  );
  if (!parsed.success) {
    throw new Error(`${path} is not a music manifest: ${parsed.error.message}`);
  }
  return parsed.data;
}

/** Writes `data` to `path` through a uniquely named temporary file. */
function writeAtomically(path: string, data: string | Uint8Array): void {
  const temporary = `${path}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    writeFileSync(temporary, data, { flag: "wx", mode: 0o644 });
    renameSync(temporary, path);
  } catch (error) {
    try {
      unlinkSync(temporary);
    } catch {
      // Nothing left to clean up.
    }
    throw error;
  }
}

/** The hex SHA-256 of `bytes`. */
function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Reads `response`'s body, refusing more than `limit` bytes. */
async function readCapped(
  response: Response,
  limit: number,
): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > limit) throw new Error(`is over ${limit} bytes`);
  const reader = response.body?.getReader();
  if (reader === undefined) throw new Error("has no body");
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new Error(`is over ${limit} bytes`);
    }
    chunks.push(value);
  }
  if (total === 0) throw new Error("is empty");
  return Buffer.concat(chunks);
}

export interface PrefetchResult {
  /** Downloaded now. */
  readonly saved: readonly string[];
  /** Already on disk, unchanged since the manifest recorded it. */
  readonly kept: readonly string[];
  readonly failed: readonly { slug: string; error: string }[];
}

/**
 * Saves each of `slugs` from mus.ax into `dir` as `<slug>.mp3`, keeping a
 * file the manifest already vouches for, then rewrites the manifest with
 * every track that's on disk, in `slugs`' order.
 */
export async function prefetch({
  base,
  slugs,
  dir,
  fetch = globalThis.fetch,
  maxBytes = maxTrackBytes,
}: {
  base: string;
  slugs: readonly string[];
  dir: string;
  fetch?: CatalogFetch;
  maxBytes?: number;
}): Promise<PrefetchResult> {
  mkdirSync(dir, { recursive: true });
  const catalog = new Map(
    (await readCatalog(base, fetch)).map((song) => [song.slug, song]),
  );
  const previous = new Map(
    readManifest(dir).tracks.map((track) => [track.slug, track]),
  );
  const saved: string[] = [];
  const kept: string[] = [];
  const failed: { slug: string; error: string }[] = [];
  const tracks: ManifestTrack[] = [];

  for (const slug of slugs) {
    const song = catalog.get(slug);
    if (!slugPattern.test(slug) || song === undefined) {
      failed.push({ slug, error: "not in mus.ax's catalog" });
      continue;
    }
    const file = join(dir, `${slug}.mp3`);
    const known = previous.get(slug);
    if (
      known !== undefined &&
      existsSync(file) &&
      sha256(readFileSync(file)) === known.sha256
    ) {
      tracks.push({ ...known, title: song.title });
      kept.push(slug);
      continue;
    }
    try {
      // The signal also bounds readCapped's body read below.
      const response = await fetch(new URL(`/audio/${slug}.mp3`, base), {
        signal: AbortSignal.timeout(audioTimeoutMs),
      });
      if (!response.ok) throw new Error(`answered ${response.status}`);
      const type = response.headers.get("content-type") ?? "";
      if (!type.startsWith("audio/mpeg")) {
        throw new Error(`is ${type || "untyped"}, not audio/mpeg`);
      }
      const bytes = await readCapped(response, maxBytes);
      writeAtomically(file, bytes);
      tracks.push({
        slug,
        title: song.title,
        duration_seconds: song.duration_seconds ?? null,
        bytes: bytes.byteLength,
        sha256: sha256(bytes),
      });
      saved.push(slug);
    } catch (error) {
      failed.push({
        slug,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  writeAtomically(
    join(dir, manifestName),
    `${JSON.stringify({ version: 1, tracks } satisfies Manifest, null, 2)}\n`,
  );
  return { saved, kept, failed };
}

/**
 * The tracks of `slugs` that the manifest in `dir` lists and the disk holds
 * at the recorded size, in `slugs`' order, and the slugs left out.
 */
export function loadPlaylist(
  dir: string,
  slugs: readonly string[],
): { tracks: Track[]; missing: string[] } {
  const manifest = new Map(
    readManifest(dir).tracks.map((track) => [track.slug, track]),
  );
  const tracks: Track[] = [];
  const missing: string[] = [];
  for (const slug of slugs) {
    const entry = manifest.get(slug);
    const file = join(dir, `${slug}.mp3`);
    if (
      entry === undefined ||
      !existsSync(file) ||
      statSync(file).size !== entry.bytes
    ) {
      missing.push(slug);
      continue;
    }
    tracks.push({
      slug,
      title: entry.title,
      file,
      durationSeconds: entry.duration_seconds,
    });
  }
  return { tracks, missing };
}
