import { Schema } from "effect";

/**
 * The public allthings contract: the shapes served by the MCP server and the
 * public API, and consumed by the CLI. These Effect schemas will replace the
 * zod ones in app/src/lib/public-api/schemas.ts; until then a contract test
 * holds them to the same shapes, the same validation and today's live data.
 */

// zod's `domain` regex, so hosts are judged exactly as `z.httpUrl()` judges them.
const domain =
  /^(?=.{1,253}$)([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/;

/**
 * An absolute http(s) URL with a domain-name host, as `z.httpUrl()` accepts.
 * zod also trims whitespace and strips tabs and newlines before checking;
 * served values must already be clean, so this rejects them instead.
 */
export const HttpUrl = Schema.String.check(
  Schema.makeFilter(
    (value: string) => {
      if (/^\s|\s$|[\t\n\r]/.test(value)) {
        return "expected a URL without surrounding whitespace or line breaks";
      }
      if (!/^https?:\/\//i.test(value)) return "expected an http(s):// URL";
      const url = URL.parse(value);
      if (url === null) return "expected a parseable URL";
      return domain.test(url.hostname) || "expected a domain-name host";
    },
    {
      expected: "an http(s) URL",
      // JSON Schema can only say "uri"; the host and protocol rules are looser there.
      toJsonSchema: () => [{ format: "uri" }, true],
    },
  ),
);

// zod's ISO date source, which rejects impossible dates such as 2026-02-30.
const isoDate =
  "(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))";

const isoInstant = new RegExp(
  `^${isoDate}T(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?Z$`,
);

/** An ISO 8601 UTC instant with seconds, as `z.iso.datetime()` accepts. */
export const IsoInstant = Schema.String.check(
  Schema.isPattern(isoInstant, {
    expected: "an ISO 8601 UTC instant",
    toJsonSchema: () => ({ format: "date-time", pattern: isoInstant.source }),
  }),
);

export const EventStatus = Schema.Literals([
  "upcoming",
  "live",
  "past",
]).annotate({
  description: "Whether the event is still ahead, happening now, or over.",
});

export const PersonLinks = Schema.Struct({
  x: Schema.NullOr(HttpUrl),
  bluesky: Schema.NullOr(HttpUrl),
  linkedin: Schema.NullOr(HttpUrl),
});

export const EventSummary = Schema.Struct({
  slug: Schema.String.annotate({
    description: "Stable identifier; pass it to get_event.",
  }),
  name: Schema.String,
  tagline: Schema.String,
  url: HttpUrl.annotate({ description: "Event page on allthingsweb.dev." }),
  status: EventStatus,
  startsAt: IsoInstant.annotate({
    description: "Start time as an ISO 8601 UTC instant.",
  }),
  endsAt: IsoInstant.annotate({
    description: "End time as an ISO 8601 UTC instant.",
  }),
  timeZone: Schema.Literal("America/Los_Angeles").annotate({
    description: "Local time zone for presenting times.",
  }),
  venue: Schema.NullOr(
    Schema.Struct({
      name: Schema.NullOr(Schema.String),
      address: Schema.NullOr(Schema.String),
    }),
  ),
  rsvpUrl: Schema.NullOr(HttpUrl).annotate({
    description: "Where to register. Registration always happens on this page.",
  }),
  recordingUrl: Schema.NullOr(HttpUrl),
  isHackathon: Schema.Boolean,
});

export const TalkSpeaker = Schema.Struct({
  name: Schema.String,
  title: Schema.NullOr(Schema.String),
  bio: Schema.NullOr(Schema.String),
  links: PersonLinks,
});

export const Event = Schema.Struct({
  ...EventSummary.fields,
  talks: Schema.Array(
    Schema.Struct({
      title: Schema.String,
      description: Schema.String.annotate({ description: "Plain text." }),
      speakers: Schema.Array(TalkSpeaker),
    }),
  ),
  hosts: Schema.Array(
    Schema.Struct({ name: Schema.String, about: Schema.String }),
  ).annotate({
    description: "Companies hosting the event: space, food and drinks.",
  }),
});

export const Speaker = Schema.Struct({
  ...TalkSpeaker.fields,
  talks: Schema.Array(
    Schema.Struct({
      title: Schema.String,
      eventName: Schema.String,
      eventSlug: Schema.String,
      eventUrl: HttpUrl,
      date: IsoInstant,
    }),
  ),
});

export const Community = Schema.Struct({
  name: Schema.String,
  oneLiner: Schema.String,
  introduction: Schema.String,
  mission: Schema.String,
  history: Schema.String,
  independence: Schema.String,
  hosting: Schema.String,
  links: Schema.Struct({
    website: HttpUrl,
    events: HttpUrl,
    discord: HttpUrl,
    codeOfConduct: HttpUrl,
  }),
});

export type EventStatus = typeof EventStatus.Type;
export type PersonLinks = typeof PersonLinks.Type;
export type EventSummary = typeof EventSummary.Type;
export type TalkSpeaker = typeof TalkSpeaker.Type;
export type Event = typeof Event.Type;
export type Speaker = typeof Speaker.Type;
export type Community = typeof Community.Type;
