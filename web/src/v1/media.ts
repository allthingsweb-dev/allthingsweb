import { Option } from "effect";

/**
 * Image URLs as the app publishes them, ported from app/src/lib/media.ts.
 * Images still in the legacy bucket are served from the app's own
 * /media/<key> route; every other URL is published as stored.
 */

const mediaPathPrefix = "/media/";

// Letters and digits in any script, then combining marks, dots, dashes and
// underscores; never separators, spaces or percent signs.
const keySegment = /^[\p{L}\p{N}_][\p{L}\p{M}\p{N}._-]*$/u;

function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/** The bucket key in `segments`, or null if any segment is not a valid key segment. */
function mediaKey(segments: ReadonlyArray<string>): string | null {
  if (segments.length === 0) return null;
  const decoded: Array<string> = [];
  for (const segment of segments) {
    const value = decodeSegment(segment);
    if (value === null || !keySegment.test(value) || value.includes("..")) {
      return null;
    }
    decoded.push(value);
  }
  return decoded.join("/");
}

/**
 * Maps a stored URL under `legacyOrigin` to its /media/ path; returns other
 * URLs, and every URL when there is no legacy origin, unchanged.
 */
export function mediaUrl(
  storedUrl: string,
  legacyOrigin: Option.Option<string>,
): string {
  if (Option.isNone(legacyOrigin)) return storedUrl;
  const prefix = `${legacyOrigin.value}/`;
  if (!storedUrl.startsWith(prefix)) return storedUrl;
  const key = mediaKey(storedUrl.slice(prefix.length).split("/"));
  return key === null
    ? storedUrl
    : `${mediaPathPrefix}${key.split("/").map(encodeURIComponent).join("/")}`;
}
