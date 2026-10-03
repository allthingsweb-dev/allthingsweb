import { and, asc, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { imagesTable, profilesTable } from "@/lib/schema";

export type ProfilePhoto = {
  bytes: Uint8Array;
  width: number;
  height: number;
  format: string;
  placeholder: string;
};

type Cancellable = { signal: AbortSignal };

export type ProfilePhotoDependencies = {
  database: Pick<PgDatabase<PgQueryResultHKT>, "select"> & {
    execute: (query: SQL) => PromiseLike<{ rows: unknown[] }>;
  };
  download: (url: string, options: Cancellable) => Promise<Uint8Array>;
  process: (bytes: Uint8Array) => Promise<ProfilePhoto>;
  /** Stores the photo under `key` and returns its stored URL. */
  store: (
    key: string,
    photo: ProfilePhoto,
    options: Cancellable,
  ) => Promise<string>;
  /** Deletes a stored photo that did not end up on the profile. */
  remove: (key: string) => Promise<void>;
  newId: () => string;
  now: () => number;
};

export type ProfilePhotoResult = {
  ingested: string[];
  failed: { name: string; error: string }[];
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The bucket key convention used for profile photos. */
export function profilePhotoKey(name: string, imageId: string, format: string) {
  return `profiles/${name.toLowerCase().replace(/ /g, "-")}-${imageId}.${format}`;
}

/**
 * Records the photo and makes it the profile's image in one statement, only
 * while the profile still has none; a photo set meanwhile wins.
 */
async function savePhoto(
  database: ProfilePhotoDependencies["database"],
  photo: {
    profileId: string;
    imageId: string;
    url: string;
    alt: string;
    image: ProfilePhoto;
  },
): Promise<boolean> {
  const result = await database.execute(sql`
    with target as (
      select ${profilesTable.id} from ${profilesTable}
      where ${profilesTable.id} = ${photo.profileId}
        and ${profilesTable.image} is null
      for update
    ), image as (
      insert into ${imagesTable}
        (id, url, alt, placeholder, width, height, created_at, updated_at)
      select ${photo.imageId}::uuid, ${photo.url}, ${photo.alt},
        ${photo.image.placeholder}, ${photo.image.width}::integer,
        ${photo.image.height}::integer, now(), now()
      from target
      returning id
    )
    update ${profilesTable}
    set image = image.id, updated_at = now()
    from image
    where ${profilesTable.id} = ${photo.profileId}
    returning ${profilesTable.id}
  `);
  return result.rows.length > 0;
}

/**
 * Gives profiles without a photo the one at their `photo_source_url`. Photos
 * already set are never replaced, and one failure never stops the others.
 */
export async function ingestProfilePhotos(
  deps: ProfilePhotoDependencies,
  {
    budgetMs = 20_000,
    signal = new AbortController().signal,
  }: { budgetMs?: number; signal?: AbortSignal } = {},
): Promise<ProfilePhotoResult> {
  const deadline = deps.now() + budgetMs;
  const result: ProfilePhotoResult = { ingested: [], failed: [] };
  const profiles = await deps.database
    .select({
      id: profilesTable.id,
      name: profilesTable.name,
      source: profilesTable.photoSourceUrl,
    })
    .from(profilesTable)
    .where(
      and(isNull(profilesTable.image), isNotNull(profilesTable.photoSourceUrl)),
    )
    .orderBy(asc(profilesTable.createdAt));

  for (const profile of profiles) {
    if (deps.now() >= deadline || signal.aborted || !profile.source) break;
    let unusedKey: string | null = null;
    try {
      const photo = await deps.process(
        await deps.download(profile.source, { signal }),
      );
      const imageId = deps.newId();
      const key = profilePhotoKey(profile.name, imageId, photo.format);
      const url = await deps.store(key, photo, { signal });
      unusedKey = key;
      signal.throwIfAborted();
      const saved = await savePhoto(deps.database, {
        profileId: profile.id,
        imageId,
        url,
        alt: profile.name,
        image: photo,
      });
      if (saved) {
        unusedKey = null;
        result.ingested.push(profile.name);
      }
    } catch (error) {
      result.failed.push({ name: profile.name, error: errorMessage(error) });
    }
    if (unusedKey) {
      await deps.remove(unusedKey).catch((error: unknown) => {
        result.failed.push({
          name: profile.name,
          error: `Could not delete unused photo ${unusedKey}: ${errorMessage(error)}`,
        });
      });
    }
  }
  return result;
}
