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
});

/** A published `events` row with its preview image, if it has one. */
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
});

/** A `profiles` row as a speaker: who they are and where to find them. */
export const Profile = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  title: Schema.String,
  bio: Schema.String,
  twitterHandle: Schema.NullOr(Schema.String),
  blueskyHandle: Schema.NullOr(Schema.String),
  linkedinHandle: Schema.NullOr(Schema.String),
  image: Schema.NullOr(Image),
});

/** A `talks` row with its speakers from `talk_speakers`. */
export const Talk = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  /** Editor HTML as stored; render it through `sanitizeRichText`. */
  description: Schema.String,
  speakers: Schema.Array(Profile),
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
  talks: Schema.Array(Talk),
  hosts: Schema.Array(Host),
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

/** A `redirects` row: `/r/<slug>` sends visitors to `destinationUrl`. */
export const Redirect = Schema.Struct({
  slug: Schema.String,
  destinationUrl: Schema.String,
});

export type Image = typeof Image.Type;
export type Event = typeof Event.Type;
export type Profile = typeof Profile.Type;
export type Talk = typeof Talk.Type;
export type Host = typeof Host.Type;
export type EventDetails = typeof EventDetails.Type;
export type DirectoryRow = typeof DirectoryRow.Type;
export type Redirect = typeof Redirect.Type;
