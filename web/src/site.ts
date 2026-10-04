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
  /** Public links (event pages, the code of conduct) are built from it. */
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
