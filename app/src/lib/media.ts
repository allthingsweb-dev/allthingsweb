/**
 * Stored images live in a private bucket. Pages reference them through
 * /media/<key>, a stable same-origin URL the CDN can cache forever, instead of
 * presigned links that change on every render.
 */
export const mediaPathPrefix = "/media/";

// Letters and digits in any script, since keys are derived from names such as
// "Erik Peña", then dots, dashes and underscores. Never separators, spaces or
// percent signs.
const keySegment = /^[\p{L}\p{N}_][\p{L}\p{N}._-]*$/u;

/** Maps a stored bucket URL to its media path; other URLs are returned as is. */
export function toMediaUrl(storedUrl: string, storageOrigin: string): string {
  const prefix = `${storageOrigin}/`;
  if (!storedUrl.startsWith(prefix)) return storedUrl;
  const key = mediaKeyFromSegments(storedUrl.slice(prefix.length).split("/"));
  return key
    ? `${mediaPathPrefix}${key.split("/").map(encodeURIComponent).join("/")}`
    : storedUrl;
}

function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/**
 * Validates path segments from /media/[...key], decoding any percent-encoding
 * first so an encoded "..", "/" or space is judged as what it decodes to.
 * Returns the bucket key, or null to reject the request.
 */
export function mediaKeyFromSegments(
  segments: readonly string[],
): string | null {
  if (segments.length === 0) return null;
  const decoded = segments.map(decodeSegment);
  if (
    !decoded.every(
      (segment): segment is string =>
        segment !== null && keySegment.test(segment) && !segment.includes(".."),
    )
  ) {
    return null;
  }
  return decoded.join("/");
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
