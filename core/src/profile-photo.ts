import { Data, Effect } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import {
  applyImageChange,
  type ImageChange,
  type ImageFile,
  type ImageTools,
  planImageChange,
  type PreparedRequest,
  prepareImage,
} from "./image-columns.ts";
import { profilePhotoKey } from "./ingest/ingest.ts";

/**
 * A profile's photo (`profiles.image`), set from a local file as
 * src/image-columns.ts sets an image column, with the key and alt text the
 * old admin gave it (app/scripts' set_profile_image and the admin's profile
 * routes, as src/ingest's profilePhotoKey keys it):
 * "profiles/<name as a slug>-<image id>.<jpg|webp>", and the person's name.
 */

export class ProfilePhotoError extends Data.TaggedError("ProfilePhotoError")<{
  readonly reason: string;
}> {
  override get message(): string {
    return this.reason;
  }
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const refuse = (reason: string) =>
  Effect.fail(new ProfilePhotoError({ reason }));

/**
 * The profile named by `profile`: its id, its slug (as /people/<slug> has
 * it), or its exact name when only one profile has that name.
 */
export const findProfile = (profile: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    const found = uuid.test(profile)
      ? yield* sql<{ id: string; name: string; slug: string }>`
          SELECT id::text AS id, name, slug FROM profiles
          WHERE id = ${profile.toLowerCase()}::uuid`
      : yield* sql<{ id: string; name: string; slug: string }>`
          SELECT id::text AS id, name, slug FROM profiles
          WHERE slug = ${profile} OR name = ${profile}
          ORDER BY slug`;
    const bySlug = found.filter((row) => row.slug === profile);
    const matches = bySlug.length > 0 ? bySlug : found;
    if (matches.length === 0) {
      return yield* refuse(
        `No profile is ${profile}: give its id, its slug or its exact name.`,
      );
    }
    if (matches.length > 1) {
      return yield* refuse(
        `${matches.length} profiles are named ${profile}: give one's slug (${matches.map((row) => row.slug).join(", ")}) or id.`,
      );
    }
    const match = matches[0]!;
    return {
      table: "profiles",
      id: match.id,
      name: match.name,
    } satisfies ImageChange["row"];
  });

/** The photo file, encoded, as the request to set the profile's image. */
const photoRequest = (
  person: ImageChange["row"],
  file: ImageFile,
  tools: Pick<ImageTools, "encode" | "placeholder">,
) =>
  Effect.gen(function* () {
    const request: PreparedRequest = {
      column: { table: "profiles", column: "image" },
      image: yield* prepareImage(file, tools),
      alt: person.name,
      key: (imageId, extension) =>
        profilePhotoKey(person.name, imageId, extension),
    };
    return [request];
  });

/**
 * What setting `profile`'s photo from `file` would do, and the approval
 * token for exactly that. It encodes the file and reads; it stores and
 * writes nothing.
 */
export const planProfilePhoto = (
  profile: string,
  file: ImageFile,
  tools: Pick<ImageTools, "encode" | "placeholder" | "origin">,
) =>
  Effect.gen(function* () {
    const person = yield* findProfile(profile);
    const requests = yield* photoRequest(person, file, tools);
    return yield* planImageChange(person, requests, tools.origin);
  });

/**
 * Sets `profile`'s photo from `file`, exactly as the dry run that printed
 * `token` showed, or refuses if anything changed since.
 */
export const setProfilePhoto = (
  profile: string,
  file: ImageFile,
  token: string,
  tools: ImageTools,
) =>
  Effect.gen(function* () {
    const person = yield* findProfile(profile);
    const requests = yield* photoRequest(person, file, tools);
    return yield* applyImageChange(person, requests, token, {
      media: tools.media,
      origin: tools.origin,
      again: "people photo --dry-run",
    });
  });
