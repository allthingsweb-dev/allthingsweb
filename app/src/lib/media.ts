/**
 * Stored images live in a private bucket. Pages reference them through
 * /media/<key>, a stable same-origin URL the CDN can cache forever, instead of
 * presigned links that change on every render.
 */
export const mediaPathPrefix = "/media/";

const keySegment = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;

/** Maps a stored bucket URL to its media path; other URLs are returned as is. */
export function toMediaUrl(storedUrl: string, storageOrigin: string): string {
  const prefix = `${storageOrigin}/`;
  if (!storedUrl.startsWith(prefix)) return storedUrl;
  const key = storedUrl.slice(prefix.length);
  return mediaKeyFromSegments(key.split("/"))
    ? `${mediaPathPrefix}${key}`
    : storedUrl;
}

/** Validates path segments from /media/[...key]; null rejects the request. */
export function mediaKeyFromSegments(
  segments: readonly string[],
): string | null {
  if (segments.length === 0) return null;
  if (
    !segments.every(
      (segment) => keySegment.test(segment) && !segment.includes(".."),
    )
  ) {
    return null;
  }
  return segments.join("/");
}

export type MediaObject = {
  body: ReadableStream<Uint8Array>;
  contentType: string | undefined;
  contentLength: number | undefined;
  etag: string | undefined;
};

export type MediaDependencies = {
  storageOrigin: string;
  /** Only objects referenced by an image record are ever served. */
  isKnownImage: (storedUrl: string) => Promise<boolean>;
  getObject: (key: string) => Promise<MediaObject | null>;
};

export async function serveMedia(
  segments: readonly string[],
  deps: MediaDependencies,
): Promise<Response> {
  const key = mediaKeyFromSegments(segments);
  if (!key || !(await deps.isKnownImage(`${deps.storageOrigin}/${key}`))) {
    return new Response("Not found", { status: 404 });
  }
  const object = await deps.getObject(key);
  if (!object) return new Response("Not found", { status: 404 });

  const headers = new Headers({
    "content-type": object.contentType ?? "application/octet-stream",
    // Keys are unique per upload, so their content never changes.
    "cache-control": "public, max-age=31536000, immutable",
    "x-content-type-options": "nosniff",
  });
  if (object.contentLength !== undefined) {
    headers.set("content-length", String(object.contentLength));
  }
  if (object.etag) headers.set("etag", object.etag);
  return new Response(object.body, { headers });
}
