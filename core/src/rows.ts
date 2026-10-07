import { Schema } from "effect";

/**
 * What the repositories read from Postgres, decoded at the boundary. Only the
 * columns the public site uses are selected; the rest of each table (Luma
 * bookkeeping, admin flags, timestamps) stays out of the read side.
 *
 * Column names follow app/src/lib/schema.ts, which owns the tables until the
 * migrations move here. The `sponsors` tables are hosts in code.
 */

/** A row of `images`, nested as JSON wherever an image is referenced. */
export const Image = Schema.Struct({
  url: Schema.String,
  alt: Schema.String,
  placeholder: Schema.String,
  width: Schema.Int,
  height: Schema.Int,
  /** As `Photo.version`: `updated_at` in whole seconds, as digits. */
  version: Schema.String,
});

/**
 * Who organizes a shared event: a company (`events.organized_by`, a
 * `sponsors` row), with its own site and handles, where pages link out.
 */
export const Organizer = Schema.Struct({
  name: Schema.String,
  websiteUrl: Schema.NullOr(Schema.String),
  twitterHandle: Schema.NullOr(Schema.String),
  blueskyHandle: Schema.NullOr(Schema.String),
  linkedinHandle: Schema.NullOr(Schema.String),
});

/**
 * Whose evening an event is (`events.curation`): ours, or someone else's we
 * share with our community because we think it's good, with who organizes
 * it. The database holds the two together.
 */
export const Curation = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("ours") }),
  Schema.Struct({ kind: Schema.Literal("shared"), organizer: Organizer }),
]);

/**
 * A published `events` row with its preview image, if it has one, and whose
 * evening it is.
 */
export const Event = Schema.Struct({
  id: Schema.String,
  slug: Schema.String,
  name: Schema.String,
  tagline: Schema.String,
  startDate: Schema.DateTimeUtcFromDate,
  endDate: Schema.DateTimeUtcFromDate,
  streetAddress: Schema.NullOr(Schema.String),
  shortLocation: Schema.NullOr(Schema.String),
  fullAddress: Schema.NullOr(Schema.String),
  lumaEventId: Schema.NullOr(Schema.String),
  recordingUrl: Schema.NullOr(Schema.String),
  isHackathon: Schema.Boolean,
  previewImage: Schema.NullOr(Image),
  curation: Curation,
});

/** A `profiles` row as a speaker: who they are and where to find them. */
export const Profile = Schema.Struct({
  id: Schema.String,
  /** Their address on the site, /people/<slug> (see src/person-slug.ts). */
  slug: Schema.String,
  name: Schema.String,
  title: Schema.String,
  bio: Schema.String,
  twitterHandle: Schema.NullOr(Schema.String),
  blueskyHandle: Schema.NullOr(Schema.String),
  linkedinHandle: Schema.NullOr(Schema.String),
  image: Schema.NullOr(Image),
});

/**
 * What kind of evening an event is (`events.program`): a lineup on stage,
 * an open floor of community demos, a social evening, or a hackathon. Only
 * an evening of talks is expected to have talks.
 */
export const EventProgram = Schema.Literals([
  "talks",
  "open-floor",
  "social",
  "hackathon",
]);

/** How a talk is held (`talks.format`): see src/people.ts. */
export const TalkFormat = Schema.Literals(["talk", "panel", "fireside"]);

/** A speaker's part in a talk (`talk_speakers.role`): see src/people.ts. */
export const SpeakerRole = Schema.Literals(["speaker", "moderator"]);

/** A person's part in an event as a whole (`event_people.role`). */
export const EventRole = Schema.Literals(["organizer", "co-host", "mc"]);

/** A talk's speaker: their profile and their part in the talk. */
export const TalkSpeaker = Schema.Struct({
  ...Profile.fields,
  role: SpeakerRole,
});

/** A `talks` row with its speakers from `talk_speakers`. */
export const Talk = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  /** Editor HTML as stored; render it through `sanitizeRichText`. */
  description: Schema.String,
  format: TalkFormat,
  speakers: Schema.Array(TalkSpeaker),
});

/** A row of `event_people`: someone's part in the event, apart from its talks. */
export const EventPerson = Schema.Struct({
  role: EventRole,
  profile: Profile,
});

/**
 * A `sponsors` row. Either logo may be missing; the page decides what to show
 * instead (today: the other variant, then the brand's blank avatar).
 */
export const Host = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  about: Schema.String,
  squareLogoLight: Schema.NullOr(Image),
  squareLogoDark: Schema.NullOr(Image),
});

/** A published event with everything its page shows. */
export const EventDetails = Schema.Struct({
  ...Event.fields,
  /** Guests going ("went", once it is over), as Luma counted them. */
  lumaGuestCount: Schema.NullOr(Schema.Int),
  /** Guests checked in at the door, as Luma counted them. */
  lumaCheckedInCount: Schema.NullOr(Schema.Int),
  talks: Schema.Array(Talk),
  hosts: Schema.Array(Host),
  /** Organizers, then co-hosts, then the MC, each in their order. */
  people: Schema.Array(EventPerson),
  images: Schema.Array(Image),
});

/** One talk given at one past, published event, as the speaker directory lists it. */
export const DirectoryRow = Schema.Struct({
  profile: Profile,
  talkId: Schema.String,
  talkTitle: Schema.String,
  talkDescription: Schema.String,
  eventId: Schema.String,
  eventName: Schema.String,
  eventSlug: Schema.String,
  eventStart: Schema.DateTimeUtcFromDate,
});

/**
 * A published event as the home page lists it, with its hosts' names in
 * attach order. It arrives nested in JSON, so its instants are ISO text.
 */
export const Listing = Schema.Struct({
  id: Schema.String,
  slug: Schema.String,
  name: Schema.String,
  /** The topic the site set, which the database holds to the lockup's rule. */
  topic: Schema.NullOr(Schema.String),
  startDate: Schema.DateTimeUtcFromString,
  endDate: Schema.DateTimeUtcFromString,
  streetAddress: Schema.NullOr(Schema.String),
  shortLocation: Schema.NullOr(Schema.String),
  fullAddress: Schema.NullOr(Schema.String),
  lumaEventId: Schema.NullOr(Schema.String),
  hosts: Schema.Array(Schema.String),
  curation: Curation,
});

/** A photo from one of our evenings, from `event_images`. */
export const Photo = Schema.Struct({
  url: Schema.String,
  alt: Schema.String,
  width: Schema.Int,
  height: Schema.Int,
  /**
   * The image row's `updated_at` in whole seconds since the epoch, as
   * digits. It changes whenever the row does, so URLs derived from the photo
   * can name it and be cached for good.
   */
  version: Schema.String,
});

/** A profile's photo, from `profiles.image`, with the profile's id. */
export const Portrait = Schema.Struct({
  profileId: Schema.String,
  ...Photo.fields,
});

/** What the home page reads, in one statement. */
export const HomeRow = Schema.Struct({
  /** Our soonest event that hasn't ended, if one is announced. */
  next: Schema.NullOr(Listing),
  /** Every event that hasn't ended, soonest first, up to the limit. */
  ahead: Schema.Array(Listing),
  /** The latest events that have ended, latest first, up to the limit. */
  recent: Schema.Array(Listing),
  photos: Schema.Array(Photo),
});

/** A `redirects` row: `/r/<slug>` sends visitors to `destinationUrl`. */
export const Redirect = Schema.Struct({
  slug: Schema.String,
  destinationUrl: Schema.String,
});

export type Image = typeof Image.Type;
export type Event = typeof Event.Type;
export type Profile = typeof Profile.Type;
export type EventProgram = typeof EventProgram.Type;
export type Organizer = typeof Organizer.Type;
export type Curation = typeof Curation.Type;
export type TalkFormat = typeof TalkFormat.Type;
export type SpeakerRole = typeof SpeakerRole.Type;
export type EventRole = typeof EventRole.Type;
export type TalkSpeaker = typeof TalkSpeaker.Type;
export type Talk = typeof Talk.Type;
export type EventPerson = typeof EventPerson.Type;
export type Host = typeof Host.Type;
export type EventDetails = typeof EventDetails.Type;
export type DirectoryRow = typeof DirectoryRow.Type;
export type Redirect = typeof Redirect.Type;
export type Listing = typeof Listing.Type;
export type Photo = typeof Photo.Type;
export type Portrait = typeof Portrait.Type;
export type HomeRow = typeof HomeRow.Type;
