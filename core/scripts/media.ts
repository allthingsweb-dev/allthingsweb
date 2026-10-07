import { Config, Effect, Redacted } from "effect";
import { encodeKey, type Media } from "../src/reencode.ts";

/**
 * The bucket as core's scripts reach it: objects are read from the media
 * origin, and stored through the upload Worker (MEDIA_UPLOAD_URL, with
 * MEDIA_UPLOAD_TOKEN), which never replaces an object.
 */

/** Where the bucket's objects are served. */
export const mediaOrigin = "https://media.allthings.dev";

/** The media origin, and the upload Worker behind it, over HTTP. */
export const httpMedia = (
  uploadUrl: string,
  token: Redacted.Redacted,
): Media => ({
  size: async (url) => {
    const response = await fetch(url, { method: "HEAD" });
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error(`HEAD ${url}: ${response.status}`);
    const length = response.headers.get("content-length");
    if (length === null) throw new Error(`HEAD ${url}: no content-length`);
    return Number(length);
  },
  get: async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`GET ${url}: ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  },
  put: async (key, bytes, contentType) => {
    const response = await fetch(`${uploadUrl}/${encodeKey(key)}`, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${Redacted.value(token)}`,
        "content-type": contentType,
      },
      body: bytes,
    });
    if (response.status === 409) return "exists";
    if (!response.ok) throw new Error(`PUT ${key}: ${response.status}`);
    return "created";
  },
});

/** The upload Worker from MEDIA_UPLOAD_URL and MEDIA_UPLOAD_TOKEN. */
export const uploadMedia = Effect.gen(function* () {
  return httpMedia(
    (yield* Config.String("MEDIA_UPLOAD_URL")).replace(/\/+$/, ""),
    yield* Config.Redacted("MEDIA_UPLOAD_TOKEN"),
  );
});

/** A dry run never reaches the bucket. */
export const noMedia: Media = {
  size: () => Promise.reject(new Error("a dry run stores nothing")),
  get: () => Promise.reject(new Error("a dry run stores nothing")),
  put: () => Promise.reject(new Error("a dry run stores nothing")),
};
