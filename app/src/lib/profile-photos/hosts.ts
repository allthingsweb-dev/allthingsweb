/**
 * Where profile photos may come from: GitHub, X, YC founder profiles, Luma
 * and LinkedIn. Each profile's `photo_source_url` points at one of these.
 */
export const profilePhotoHosts: ReadonlySet<string> = new Set([
  "avatars.githubusercontent.com",
  "pbs.twimg.com",
  "bookface-images.s3.amazonaws.com",
  "images.lumacdn.com",
  "media.licdn.com",
]);
