import {
  pgTable,
  text,
  uuid,
  pgEnum,
  boolean,
  timestamp,
  integer,
  primaryKey,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersSync as usersSyncTable } from "drizzle-orm/neon";

export { usersSyncTable };

const createdAt = timestamp("created_at", { withTimezone: true })
  .notNull()
  .defaultNow();

const updatedAt = timestamp("updated_at", { withTimezone: true })
  .notNull()
  .$onUpdate(() => new Date());

export const redirectsTable = pgTable("redirects", {
  slug: text("slug").notNull().primaryKey(),
  destinationUrl: text("destination_url").notNull(),
  comment: text("comment"),
  createdAt,
  updatedAt,
});

export type InsertRedirect = typeof redirectsTable.$inferInsert;
export type SelectRedirect = typeof redirectsTable.$inferSelect;

export const imagesTable = pgTable("images", {
  id: uuid("id").primaryKey().defaultRandom(),
  url: text("url").notNull(),
  placeholder: text("placeholder").notNull(),
  alt: text("alt").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  createdAt,
  updatedAt,
});

export type InsertImage = typeof imagesTable.$inferInsert;
export type SelectImage = typeof imagesTable.$inferSelect;

// Hosting companies. The tables keep their original `sponsors` names.
export const hostsTable = pgTable("sponsors", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  about: text("about").notNull(),
  squareLogoDark: uuid("square_logo_dark").references(() => imagesTable.id, {
    onDelete: "set null",
  }),
  squareLogoLight: uuid("square_logo_light").references(() => imagesTable.id, {
    onDelete: "set null",
  }),
  createdAt,
  updatedAt,
});

export type InsertHost = typeof hostsTable.$inferInsert;
export type SelectHost = typeof hostsTable.$inferSelect;

export const profileTypeEnum = pgEnum("profile_type", ["organizer", "member"]);

export const profilesTable = pgTable(
  "profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    title: text("title").notNull(),
    image: uuid("image").references(() => imagesTable.id, {
      onDelete: "set null",
    }),
    twitterHandle: text("twitter_handle"),
    blueskyHandle: text("bluesky_handle"),
    linkedinHandle: text("linkedin_handle"),
    /** Where to fetch the profile's photo from (GitHub, X, YC); the hourly sync
     * stores it in the bucket and sets `image`. */
    photoSourceUrl: text("photo_source_url"),
    bio: text("bio").notNull(),
    profileType: profileTypeEnum("profile_type").notNull(),
    createdAt,
    updatedAt,
    /**
     * The person's Luma user id (usr-…): how core's Luma people import
     * (core/src/luma/people.ts) recognizes them as a host of an event.
     */
    lumaUserId: text("luma_user_id").unique(),
  },
  () => [
    check(
      "profiles_luma_user_id_check",
      sql`"luma_user_id" ~ '^usr-[A-Za-z0-9]+$'`,
    ),
  ],
);

export type InsertProfile = typeof profilesTable.$inferInsert;
export type SelectProfile = typeof profilesTable.$inferSelect;

/** How a talk is held: a presentation, a panel, or a fireside chat. */
export const talkFormats = ["talk", "panel", "fireside"] as const;

export const talksTable = pgTable(
  "talks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    createdAt,
    updatedAt,
    format: text("format", { enum: talkFormats }).notNull().default("talk"),
  },
  () => [
    check("talks_format_check", sql`"format" IN ('talk', 'panel', 'fireside')`),
  ],
);

/**
 * A speaker's part in a talk: on stage presenting (or as a panel's or
 * fireside's guest), or moderating it.
 */
export const talkSpeakerRoles = ["speaker", "moderator"] as const;

export const talkSpeakersTable = pgTable(
  "talk_speakers",
  {
    talkId: uuid("talk_id")
      .notNull()
      .references(() => talksTable.id),
    speakerId: uuid("speaker_id")
      .notNull()
      .references(() => profilesTable.id),
    createdAt,
    updatedAt,
    role: text("role", { enum: talkSpeakerRoles }).notNull().default("speaker"),
  },
  (table) => [
    primaryKey({ columns: [table.talkId, table.speakerId] }),
    check("talk_speakers_role_check", sql`"role" IN ('speaker', 'moderator')`),
  ],
);

export type InsertTalk = typeof talksTable.$inferInsert;
export type SelectTalk = typeof talksTable.$inferSelect;
export type InsertTalkSpeaker = typeof talkSpeakersTable.$inferInsert;
export type SelectTalkSpeaker = typeof talkSpeakersTable.$inferSelect;

export const eventsTable = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    startDate: timestamp("start_date", { withTimezone: true }).notNull(),
    endDate: timestamp("end_date", { withTimezone: true }).notNull(),
    slug: text("slug").notNull().unique(),
    tagline: text("tagline").notNull(),
    attendeeLimit: integer("attendee_limit").notNull(),
    streetAddress: text("street_address"),
    shortLocation: text("short_location"),
    fullAddress: text("full_address"),
    lumaEventId: text("luma_event_id").unique(),
    isHackathon: boolean("is_hackathon").notNull().default(false),
    isDraft: boolean("is_draft").notNull().default(false),
    highlightOnLandingPage: boolean("highlight_on_landing_page")
      .notNull()
      .default(false),
    previewImage: uuid("preview_image").references(() => imagesTable.id, {
      onDelete: "set null",
    }),
    recordingUrl: text("recording_url"),
    createdAt,
    updatedAt,
    /**
     * all things/<topic>, set on the site for a name that yields none; the
     * Luma sync never writes it. The CHECK is core's isTopic
     * (core/src/lockup.ts), as core/migrations/0002_event_topic.ts adds it.
     */
    topic: text("topic"),
    /** Guests going ("went", once it is over), as Luma counts them; Luma-owned. */
    lumaGuestCount: integer("luma_guest_count"),
    /** Guests checked in at the door, as Luma counts them; Luma-owned. */
    lumaCheckedInCount: integer("luma_checked_in_count"),
  },
  () => [
    check("events_luma_guest_count_check", sql`"luma_guest_count" >= 0`),
    check(
      "events_luma_checked_in_count_check",
      sql`"luma_checked_in_count" >= 0`,
    ),
    check(
      "events_topic_check",
      sql`char_length("topic") <= 24
    AND "topic" IS NFC NORMALIZED
    AND "topic" = lower("topic" COLLATE "pg_c_utf8")
    AND strpos("topic", 'all things') = 0
    AND "topic" COLLATE "pg_c_utf8" ~ '^[[:alpha:][:digit:]](?:[[:alpha:][:digit:].&+#'']|(?<=[^ ]) (?=[^ ])|(?<=[[:alpha:][:digit:]])-(?=[[:alpha:][:digit:]]))*$'`,
    ),
  ],
);

export const eventHostsTable = pgTable(
  "event_sponsors",
  {
    eventId: uuid("event_id")
      .notNull()
      .references(() => eventsTable.id),
    hostId: uuid("sponsor_id")
      .notNull()
      .references(() => hostsTable.id),
    createdAt,
    updatedAt,
  },
  (table) => [primaryKey({ columns: [table.eventId, table.hostId] })],
);

/**
 * A person's part in an event as a whole, apart from its talks: an all things
 * organizer, a co-host, or the MC. Who spoke, and in what capacity, is on
 * talk_speakers.
 */
export const eventPersonRoles = ["organizer", "co-host", "mc"] as const;

/** Who wrote a row of event_people: core's Luma people import, or the site. */
export const eventPersonSources = ["luma", "site"] as const;

export const eventPeopleTable = pgTable(
  "event_people",
  {
    eventId: uuid("event_id")
      .notNull()
      .references(() => eventsTable.id),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profilesTable.id),
    role: text("role", { enum: eventPersonRoles }).notNull(),
    /** Order among the event's people in the same role, from 0. */
    position: integer("position").notNull(),
    source: text("source", { enum: eventPersonSources }).notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [
    primaryKey({ columns: [table.eventId, table.profileId, table.role] }),
    check(
      "event_people_role_check",
      sql`"role" IN ('organizer', 'co-host', 'mc')`,
    ),
    check("event_people_position_check", sql`"position" >= 0`),
    check("event_people_source_check", sql`"source" IN ('luma', 'site')`),
  ],
);

export type InsertEventPerson = typeof eventPeopleTable.$inferInsert;
export type SelectEventPerson = typeof eventPeopleTable.$inferSelect;

export const eventTalksTable = pgTable(
  "event_talks",
  {
    eventId: uuid("event_id")
      .notNull()
      .references(() => eventsTable.id),
    talkId: uuid("talk_id")
      .notNull()
      .references(() => talksTable.id),
    createdAt,
    updatedAt,
  },
  (table) => [primaryKey({ columns: [table.eventId, table.talkId] })],
);

export const eventImagesTable = pgTable(
  "event_images",
  {
    eventId: uuid("event_id")
      .notNull()
      .references(() => eventsTable.id),
    imageId: uuid("image_id")
      .notNull()
      .references(() => imagesTable.id),
    createdAt,
    updatedAt,
  },
  (table) => [primaryKey({ columns: [table.eventId, table.imageId] })],
);

export const eventReviewSessionsTable = pgTable("event_review_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => eventsTable.id, {
      onDelete: "cascade",
    })
    .unique(),
  provider: text("provider").notNull().default("discord"),
  channelId: text("channel_id").notNull(),
  rootMessageId: text("root_message_id").notNull(),
  threadId: text("thread_id").notNull().unique(),
  lastSeenMessageId: text("last_seen_message_id"),
  status: text("status").notNull().default("pending"),
  approvalMessageId: text("approval_message_id"),
  createdAt,
  updatedAt,
});

export type InsertEvent = typeof eventsTable.$inferInsert;
export type SelectEvent = typeof eventsTable.$inferSelect;
export type InsertEventHost = typeof eventHostsTable.$inferInsert;
export type SelectEventHost = typeof eventHostsTable.$inferSelect;
export type InsertEventTalk = typeof eventTalksTable.$inferInsert;
export type SelectEventTalk = typeof eventTalksTable.$inferSelect;
export type InsertEventImage = typeof eventImagesTable.$inferInsert;
export type SelectEventImage = typeof eventImagesTable.$inferSelect;
export type InsertEventReviewSession =
  typeof eventReviewSessionsTable.$inferInsert;
export type SelectEventReviewSession =
  typeof eventReviewSessionsTable.$inferSelect;

export const administratorsTable = pgTable("administrators", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => usersSyncTable.id),
  createdAt,
  updatedAt,
});

export type InsertAdministrator = typeof administratorsTable.$inferInsert;
export type SelectAdministrator = typeof administratorsTable.$inferSelect;

export const profileUsersTable = pgTable(
  "profile_users",
  {
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profilesTable.id)
      .unique(), // One profile can only be associated with one user
    userId: text("user_id")
      .notNull()
      .references(() => usersSyncTable.id),
    createdAt,
    updatedAt,
  },
  (table) => [primaryKey({ columns: [table.profileId, table.userId] })],
);

export type InsertProfileUser = typeof profileUsersTable.$inferInsert;
export type SelectProfileUser = typeof profileUsersTable.$inferSelect;
