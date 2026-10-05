/**
 * Where images of posts about events may come from: X's and Bluesky's image
 * CDNs, and LinkedIn's. Each post's `image_source_url` and
 * `author_avatar_source_url` point at one of these.
 */
export const postImageHosts: ReadonlySet<string> = new Set([
  "pbs.twimg.com",
  "cdn.bsky.app",
  "media.licdn.com",
]);
