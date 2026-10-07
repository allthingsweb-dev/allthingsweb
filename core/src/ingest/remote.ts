import { Duration, Effect, Schema, Stream } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { looksLikeImage } from "./signature.ts";

/**
 * Downloading an image from where a row says it is, as the app does
 * (app/src/lib/remote-images): HTTPS on an allowed host only, every redirect
 * checked against the same hosts before it is followed, at most 3 of them,
 * the body capped at 15 MiB while it streams, and the bytes required to be
 * a PNG, JPEG, GIF, WebP, AVIF or HEIC image (unlike the app, which
 * refuses HEIC; `Pictures` stores it as JPEG).
 */

/** Hosts Luma serves event covers from: its CDN, and Unsplash for covers picked in Luma. */
export const coverHosts: ReadonlySet<string> = new Set([
  "images.lumacdn.com",
  "cdn.lu.ma",
  "images.unsplash.com",
]);

/** Where profile photos come from: GitHub, X, YC founder profiles, Luma and LinkedIn. */
export const profilePhotoHosts: ReadonlySet<string> = new Set([
  "avatars.githubusercontent.com",
  "pbs.twimg.com",
  "bookface-images.s3.amazonaws.com",
  "images.lumacdn.com",
  "media.licdn.com",
]);

/**
 * Where images of posts about events come from: X's, Bluesky's and
 * LinkedIn's CDNs. A Bluesky video post's image is its thumbnail on
 * video.bsky.app, which redirects (302) to the same path on
 * video.cdn.bsky.app; every redirect is checked against this list, so both.
 */
export const postImageHosts: ReadonlySet<string> = new Set([
  "pbs.twimg.com",
  "cdn.bsky.app",
  "video.bsky.app",
  "video.cdn.bsky.app",
  "media.licdn.com",
]);

/** The most an image may weigh. */
export const maxImageBytes = 15 * 1024 * 1024;

const maxRedirects = 3;
const downloadTimeout = Duration.seconds(20);

/** An image could not be downloaded, or what came back isn't one. */
export class DownloadError extends Schema.TaggedError<DownloadError>()(
  "DownloadError",
  { reason: Schema.String, cause: Schema.optional(Schema.Defect()) },
) {
  override get message(): string {
    return this.reason;
  }
}

/** `raw` parsed, if it is HTTPS on one of `hosts`. */
export const allowedUrl = (
  raw: string,
  hosts: ReadonlySet<string>,
): Effect.Effect<URL, DownloadError> =>
  Effect.try({
    try: () => new URL(raw),
    catch: (cause) => new DownloadError({ reason: "Not a URL", cause }),
  }).pipe(
    Effect.filterOrFail(
      (url) => url.protocol === "https:" && hosts.has(url.hostname),
      (url) =>
        new DownloadError({
          reason: `URL is not on an allowed host: ${url.origin}`,
        }),
    ),
  );

/** The body, failing as soon as it passes `maxBytes`. */
const readAtMost = <E>(body: Stream.Stream<Uint8Array, E>, maxBytes: number) =>
  body.pipe(
    Stream.runFoldEffect(
      () => ({ chunks: [] as Uint8Array[], length: 0 }),
      (read, chunk) => {
        const length = read.length + chunk.byteLength;
        return length > maxBytes
          ? Effect.fail(
              new DownloadError({
                reason: `Image is larger than ${maxBytes / 1024 / 1024} MB`,
              }),
            )
          : Effect.succeed({ chunks: [...read.chunks, chunk], length });
      },
    ),
    Effect.map(({ chunks, length }) => {
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return bytes;
    }),
  );

/**
 * Downloads the image at `raw` from one of `hosts`. Redirects are followed
 * by hand, each target checked first; the whole download is given 20
 * seconds.
 */
export const downloadImage = (
  raw: string,
  hosts: ReadonlySet<string>,
): Effect.Effect<Uint8Array, DownloadError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    let url = yield* allowedUrl(raw, hosts);
    for (let redirects = 0; ; redirects++) {
      const response = yield* client.execute(HttpClientRequest.get(url));
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers["location"];
        if (location === undefined) {
          return yield* new DownloadError({
            reason: "Redirect has no location",
          });
        }
        if (redirects === maxRedirects) {
          return yield* new DownloadError({
            reason: "Redirected too many times",
          });
        }
        const base = url;
        const next = yield* Effect.try({
          try: () => new URL(location, base).href,
          catch: (cause) =>
            new DownloadError({
              reason: "Redirect location is not a URL",
              cause,
            }),
        });
        url = yield* allowedUrl(next, hosts);
        continue;
      }
      if (response.status < 200 || response.status >= 300) {
        return yield* new DownloadError({
          reason: `Image download failed: ${response.status}`,
        });
      }
      if (Number(response.headers["content-length"]) > maxImageBytes) {
        return yield* new DownloadError({
          reason: `Image is larger than ${maxImageBytes / 1024 / 1024} MB`,
        });
      }
      const bytes = yield* readAtMost(response.stream, maxImageBytes);
      if (!looksLikeImage(bytes)) {
        return yield* new DownloadError({
          reason: "Not a PNG, JPEG, GIF, WebP, AVIF or HEIC image",
        });
      }
      return bytes;
    }
  }).pipe(
    Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }),
    Effect.timeout(downloadTimeout),
    Effect.catchTags({
      HttpClientError: (cause) =>
        Effect.fail(
          new DownloadError({ reason: "Image download failed", cause }),
        ),
      TimeoutError: () =>
        Effect.fail(new DownloadError({ reason: "Image download timed out" })),
    }),
  );
