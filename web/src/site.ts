import { HttpUrl } from "allthings-core/src/contract.ts";
import { Config, Context, Effect, Layer, Schema } from "effect";

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
  /**
   * The production site: canonical URLs and link previews, the sitemap, the
   * feed's items, calendar files and structured data name it, and only a
   * request to its host may be crawled (see seo/robots.ts). Every other
   * host the Worker answers on, such as a preview stage, is not production.
   */
  readonly origin: string;
}

export class Site extends Context.Service<Site, SiteShape>()(
  "allthings/web/Site",
) {
  /** `ORIGIN` is required. */
  static readonly layer = Layer.effect(
    Site,
    Effect.gen(function* () {
      return Site.of({
        origin: yield* Config.schema(Origin, "ORIGIN"),
      });
    }),
  );
}
