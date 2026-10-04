import { asc, count, like, sql, type SQL } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { imagesTable } from "@/lib/schema";
import type { MediaStore } from "./store";

export type LegacyObject = {
  body: Uint8Array;
  contentType: string | undefined;
};

export type LegacyCopyDependencies = {
  database: Pick<PgDatabase<PgQueryResultHKT>, "select"> & {
    execute: (query: SQL) => PromiseLike<{ rows: unknown[] }>;
  };
  /** The origin of URLs that still point at the legacy bucket. */
  legacyOrigin: string;
  /** Reads an object from the legacy bucket, or null if it doesn't exist. */
  read: (
    key: string,
    options: { signal: AbortSignal },
  ) => Promise<LegacyObject | null>;
  store: Pick<MediaStore, "put">;
  now: () => number;
};

export type LegacyCopyResult = {
  copied: number;
  /** Images still on the legacy origin after this run, or null if unknown. */
  remaining: number | null;
  failed: { url: string; error: string }[];
};

const contentTypes: Record<string, string> = {
  avif: "image/avif",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  webp: "image/webp",
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const escapeLike = (value: string) => value.replace(/[\\%_]/g, "\\$&");

/**
 * Copies images that still live in the legacy bucket into the media store and
 * points their records at the copy. Each image is copied and switched on its
 * own, oldest first, so a run that stops early simply leaves the rest for the
 * next one. Every legacy record is considered, so images that keep failing
 * can't hold back the ones after them, and a record changed meanwhile is never
 * overwritten.
 */
export async function copyLegacyImages(
  deps: LegacyCopyDependencies,
  {
    budgetMs,
    signal = new AbortController().signal,
  }: { budgetMs: number; signal?: AbortSignal },
): Promise<LegacyCopyResult> {
  const deadline = deps.now() + budgetMs;
  const prefix = `${deps.legacyOrigin.replace(/\/+$/, "")}/`;
  const onLegacyOrigin = like(imagesTable.url, `${escapeLike(prefix)}%`);
  const result: LegacyCopyResult = { copied: 0, remaining: null, failed: [] };

  const images = await deps.database
    .select({ id: imagesTable.id, url: imagesTable.url })
    .from(imagesTable)
    .where(onLegacyOrigin)
    .orderBy(asc(imagesTable.createdAt));

  for (const image of images) {
    if (deps.now() >= deadline || signal.aborted) break;
    try {
      const key = decodeURIComponent(image.url.slice(prefix.length));
      const object = await deps.read(key, { signal });
      if (!object) throw new Error("not found in the legacy bucket");
      const extension = key.split(".").pop()?.toLowerCase() ?? "";
      const url = await deps.store.put(
        key,
        object.body,
        object.contentType ??
          contentTypes[extension] ??
          "application/octet-stream",
        { signal },
      );
      const switched = await deps.database.execute(sql`
        update ${imagesTable}
        set url = ${url}, updated_at = now()
        where ${imagesTable.id} = ${image.id} and ${imagesTable.url} = ${image.url}
        returning ${imagesTable.id}
      `);
      // Zero rows: the record changed during the copy and keeps its new URL.
      if (switched.rows.length > 0) result.copied++;
    } catch (error) {
      result.failed.push({ url: image.url, error: errorMessage(error) });
    }
  }

  // A failed count must not hide the copies this run already made.
  try {
    const [remaining] = await deps.database
      .select({ value: count() })
      .from(imagesTable)
      .where(onLegacyOrigin);
    result.remaining = remaining?.value ?? 0;
  } catch (error) {
    result.failed.push({
      url: prefix,
      error: `could not count remaining images: ${errorMessage(error)}`,
    });
  }
  return result;
}
