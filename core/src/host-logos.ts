import { Data, Effect } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import {
  applyImageChange,
  type ImageChange,
  type ImageFile,
  type ImageTools,
  keySlug,
  planImageChange,
  type PreparedRequest,
  prepareImage,
} from "./image-columns.ts";

/**
 * A hosting company's two square logos (`sponsors.square_logo_dark` and
 * `square_logo_light`), set from local files as src/image-columns.ts sets
 * an image column, with the keys and alt texts the old admin gave them
 * (app/src/app/api/v1/admin/raw/hosts and app/scripts' create_host):
 * "sponsors/<name as a slug>-<dark|light>-<image id>.<jpg|webp>", and
 * "<name> dark logo" or "<name> light logo".
 */

export class HostLogosError extends Data.TaggedError("HostLogosError")<{
  readonly reason: string;
}> {
  override get message(): string {
    return this.reason;
  }
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The hosting company named `company`: its exact name, or its id. */
export const findHost = (company: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    const hosts = uuid.test(company)
      ? yield* sql<{ id: string; name: string }>`
          SELECT id::text AS id, name FROM sponsors
          WHERE id = ${company.toLowerCase()}::uuid`
      : yield* sql<{ id: string; name: string }>`
          SELECT id::text AS id, name FROM sponsors WHERE name = ${company}`;
    const host = hosts[0];
    if (host === undefined) {
      const near = yield* sql<{ name: string }>`
        SELECT name FROM sponsors
        WHERE lower(name) = lower(${company}) ORDER BY name`;
      return yield* Effect.fail(
        new HostLogosError({
          reason:
            near.length === 0
              ? `No hosting company is named ${company}.`
              : `No hosting company is named ${company}; did you mean ${near.map((row) => row.name).join(" or ")}?`,
        }),
      );
    }
    return {
      table: "sponsors",
      id: host.id,
      name: host.name,
    } satisfies ImageChange["row"];
  });

/** Where a host's logo is kept, as the old admin keyed it. */
export const hostLogoKey = (
  name: string,
  variant: "dark" | "light",
  imageId: string,
  extension: string,
) => `sponsors/${keySlug(name, "host")}-${variant}-${imageId}.${extension}`;

/** The two logo files, encoded, as requests to set the host's columns. */
const logoRequests = (
  host: ImageChange["row"],
  files: { readonly dark: ImageFile; readonly light: ImageFile },
  tools: Pick<ImageTools, "encode" | "placeholder">,
) =>
  Effect.gen(function* () {
    const requests: Array<PreparedRequest> = [];
    for (const variant of ["dark", "light"] as const) {
      requests.push({
        column: { table: "sponsors", column: `square_logo_${variant}` },
        image: yield* prepareImage(files[variant], tools),
        alt: `${host.name} ${variant} logo`,
        key: (imageId, extension) =>
          hostLogoKey(host.name, variant, imageId, extension),
      });
    }
    return requests;
  });

/**
 * What setting `company`'s logos from `files` would do, and the approval
 * token for exactly that. It encodes the files and reads; it stores and
 * writes nothing.
 */
export const planHostLogos = (
  company: string,
  files: { readonly dark: ImageFile; readonly light: ImageFile },
  tools: Pick<ImageTools, "encode" | "placeholder" | "origin">,
) =>
  Effect.gen(function* () {
    const host = yield* findHost(company);
    const requests = yield* logoRequests(host, files, tools);
    return yield* planImageChange(host, requests, tools.origin);
  });

/**
 * Sets `company`'s logos from `files`, exactly as the dry run that printed
 * `token` showed, or refuses if anything changed since.
 */
export const setHostLogos = (
  company: string,
  files: { readonly dark: ImageFile; readonly light: ImageFile },
  token: string,
  tools: ImageTools,
) =>
  Effect.gen(function* () {
    const host = yield* findHost(company);
    const requests = yield* logoRequests(host, files, tools);
    return yield* applyImageChange(host, requests, token, {
      media: tools.media,
      origin: tools.origin,
      again: "hosts logo --dry-run",
    });
  });
