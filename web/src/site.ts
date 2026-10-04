import { HttpUrl } from "allthings-core/src/contract.ts";
import { Config, Context, Effect, Layer, type Option, Schema } from "effect";

/**
 * An origin such as "https://allthingsweb.dev": an http(s) URL the public
 * contract accepts, with nothing after the host, so paths can be appended.
 */
export const Origin = HttpUrl.check(
  Schema.makeFilter(
    (value: string) =>
      URL.parse(value)?.origin === value ||
      "expected an origin without a path or trailing slash",
  ),
);

/** Site-wide settings, read once per isolate from the Worker's bindings. */
export interface SiteShape {
  /** Public links (event pages, the code of conduct) are built from it. */
  readonly origin: string;
  /**
   * The URL prefix of images still stored in the legacy bucket: the app's
   * `AWS_S3_URL`. The app serves those images from /media/<key>, so the v1
   * API rewrites their URLs the same way. Without it, URLs pass through.
   */
  readonly legacyMediaOrigin: Option.Option<string>;
}

export class Site extends Context.Service<Site, SiteShape>()(
  "allthings/web/Site",
) {
  /** `ORIGIN` is required; `LEGACY_MEDIA_ORIGIN` is optional. */
  static readonly layer = Layer.effect(
    Site,
    Effect.gen(function* () {
      return Site.of({
        origin: yield* Config.schema(Origin, "ORIGIN"),
        legacyMediaOrigin: yield* Config.option(
          Config.String("LEGACY_MEDIA_ORIGIN"),
        ),
      });
    }),
  );
}
