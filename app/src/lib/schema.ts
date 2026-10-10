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
  index,
  foreignKey,
  unique,
  type AnyPgColumn,
  date,
  pgSchema,
  uniqueIndex,
  pgPolicy,
  customType,
  jsonb,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

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
export const hostsTable = pgTable(
  "sponsors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull().unique(),
    about: text("about").notNull(),
    squareLogoDark: uuid("square_logo_dark").references(() => imagesTable.id, {
      onDelete: "set null",
    }),
    squareLogoLight: uuid("square_logo_light").references(
      () => imagesTable.id,
      { onDelete: "set null" },
    ),
    createdAt,
    updatedAt,
    /** The company's own site, https only. */
    websiteUrl: text("website_url"),
    /** Its X handle, without the @. */
    twitterHandle: text("twitter_handle"),
    /** Its Bluesky handle, a domain such as "sentry.io". */
    blueskyHandle: text("bluesky_handle"),
    /** Its LinkedIn company page, the part after linkedin.com/company/. */
    linkedinHandle: text("linkedin_handle"),
    /**
     * Its Luma account, so the people import attaches it to the events Luma
     * lists it as a host of. core/migrations/0010_host_luma_user.ts is the
     * same change.
     */
    lumaUserId: text("luma_user_id").unique(),
  },
  () => [
    check(
      "sponsors_website_url_check",
      sql`"website_url" ~ '^https://[A-Za-z0-9.-]+(/[^[:space:]]*)?$'`,
    ),
    check(
      "sponsors_twitter_handle_check",
      sql`"twitter_handle" ~ '^[A-Za-z0-9_]{1,15}$'`,
    ),
    check(
      "sponsors_bluesky_handle_check",
      sql`"bluesky_handle" ~ '^([a-z0-9]([a-z0-9-]*[a-z0-9])?[.])+[a-z]{2,}$'`,
    ),
    check(
      "sponsors_linkedin_handle_check",
      sql`"linkedin_handle" ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$'`,
    ),
    check(
      "sponsors_luma_user_id_check",
      sql`"luma_user_id" ~ '^usr-[A-Za-z0-9]+$'`,
    ),
  ],
);

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
    /**
     * How many follow them on X, as read at `xFollowersAt` from public data
     * (core/src/followers.ts); speaker lists are ordered by it.
     */
    xFollowers: integer("x_followers"),
    xFollowersAt: timestamp("x_followers_at", { withTimezone: true }),
    /** When a count was last asked for, read or not: the least recent go first. */
    xFollowersTriedAt: timestamp("x_followers_tried_at", {
      withTimezone: true,
    }),
    /**
     * Their address, /people/<slug>: set by the database from the name
     * (core/migrations/0017_person_slugs.ts), on insert and when the name
     * changes. Leave it empty to have one made.
     */
    slug: text("slug").notNull().unique().default(""),
    /** The X account's numeric id, which never changes (core/src/followers.ts). */
    xUserId: text("x_user_id").unique(),
    /** A handle cleared because X now gives it to another account, and when. */
    xHandleLost: text("x_handle_lost"),
    xHandleLostAt: timestamp("x_handle_lost_at", { withTimezone: true }),
  },
  () => [
    check(
      "profiles_luma_user_id_check",
      sql`"luma_user_id" ~ '^usr-[A-Za-z0-9]+$'`,
    ),
    check("profiles_x_followers_check", sql`"x_followers" >= 0`),
    check(
      "profiles_x_followers_at_check",
      sql`("x_followers" IS NULL) = ("x_followers_at" IS NULL)`,
    ),
    check("profiles_slug_check", sql`"slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    check("profiles_x_user_id_check", sql`"x_user_id" ~ '^[0-9]{1,20}$'`),
    check(
      "profiles_x_handle_lost_check",
      sql`("x_handle_lost" IS NULL) = ("x_handle_lost_at" IS NULL)`,
    ),
  ],
);

export type InsertProfile = typeof profilesTable.$inferInsert;
export type SelectProfile = typeof profilesTable.$inferSelect;

/** A person's earlier slugs: their old addresses redirect to the current. */
export const profileSlugsTable = pgTable(
  "profile_slugs",
  {
    slug: text("slug").primaryKey(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profilesTable.id, { onDelete: "cascade" }),
    createdAt,
  },
  (table) => [
    check("profile_slugs_slug_check", sql`"slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    index("profile_slugs_profile_id_idx").on(table.profileId),
  ],
);

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

/**
 * What kind of evening an event is: a lineup on stage, an open floor of
 * community demos, a social evening, or a hackathon.
 * core/migrations/0008_event_program.ts is the same change.
 */
export const eventPrograms = [
  "talks",
  "open-floor",
  "social",
  "hackathon",
] as const;

/**
 * Whose evening an event is: ours, or someone else's we share with our
 * community. core/migrations/0009_event_curation.ts is the same change.
 */
export const eventCurations = ["ours", "shared"] as const;

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
    /**
     * The venue is the one an organizer set: no sync replaces it
     * (core/migrations/0020_venue_by_organizer.ts).
     */
    venueByOrganizer: boolean("venue_by_organizer").notNull().default(false),
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
    /** What kind of evening it is; `is_hackathon` must agree. */
    program: text("program", { enum: eventPrograms })
      .notNull()
      .default("talks"),
    /** Ours, or shared: someone else's evening we recommend. */
    curation: text("curation", { enum: eventCurations })
      .notNull()
      .default("ours"),
    /** Who organizes a shared event; only a shared one has one. */
    organizedBy: uuid("organized_by").references(() => hostsTable.id),
    /**
     * The description on Luma, as sanitized rich text; Luma-owned. Core's
     * import from Luma's API writes it (core/src/luma/descriptions.ts), as
     * core/migrations/0011_event_description.ts adds it.
     */
    lumaDescription: text("luma_description"),
    /** Its one-line summary, which stands in for a placeholder tagline; Luma-owned. */
    lumaSummary: text("luma_summary"),
    /** The site's own description, which nothing from Luma writes; shown first. */
    description: text("description"),
    /**
     * The short link the Worker serves the event at (allthings.dev/effect),
     * one of its own in event_slugs; core gives it (core/src/slugs.ts), as
     * core/migrations/0013_short_slugs.ts adds it. `slug` stays the app's.
     */
    shortSlug: text("short_slug").unique(),
    /**
     * The cover core's generator made, as `bun run luma cover` set it on
     * Luma: its URL there, its PNG's SHA-256 and the approval token of the
     * facts it says (core/migrations/0025_generated_cover.ts). All or none.
     */
    generatedCoverUrl: text("generated_cover_url"),
    generatedCoverSha256: text("generated_cover_sha256"),
    generatedCoverFacts: text("generated_cover_facts"),
  },
  (table) => [
    foreignKey({
      name: "events_id_short_slug_event_slugs_fk",
      columns: [table.id, table.shortSlug],
      foreignColumns: [eventSlugsTable.eventId, eventSlugsTable.slug],
    }),
    check("events_luma_guest_count_check", sql`"luma_guest_count" >= 0`),
    check(
      "events_program_check",
      sql`"program" IN ('talks', 'open-floor', 'social', 'hackathon')`,
    ),
    check(
      "events_program_hackathon_check",
      sql`("program" = 'hackathon') = "is_hackathon"`,
    ),
    check("events_curation_check", sql`"curation" IN ('ours', 'shared')`),
    check(
      "events_curation_organizer_check",
      sql`("curation" = 'shared') = ("organized_by" IS NOT NULL)`,
    ),
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
    check(
      "events_generated_cover_check",
      sql`num_nonnulls("generated_cover_url", "generated_cover_sha256", "generated_cover_facts") IN (0, 3)`,
    ),
    check(
      "events_generated_cover_url_check",
      sql`"generated_cover_url" ~ '^https://images\\.lumacdn\\.com/'`,
    ),
    check(
      "events_generated_cover_sha256_check",
      sql`"generated_cover_sha256" ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "events_generated_cover_facts_check",
      sql`"generated_cover_facts" ~ '^[0-9a-f]{16}$'`,
    ),
  ],
);

/**
 * Every short link an event has been given, for good: a link never comes to
 * mean another event (core/src/short-slugs.ts).
 */
export const eventSlugsTable = pgTable(
  "event_slugs",
  {
    slug: text("slug").primaryKey(),
    eventId: uuid("event_id")
      .notNull()
      .references((): AnyPgColumn => eventsTable.id),
    createdAt,
  },
  (table) => [
    unique("event_slugs_event_id_slug_unique").on(table.eventId, table.slug),
    check(
      "event_slugs_slug_check",
      sql`"slug" ~ '^(shared/)?[a-z0-9]+(-[a-z0-9]+)*$'`,
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

/** Where a post about an event was published. */
export const eventPostPlatforms = [
  "x",
  "bluesky",
  "linkedin",
  "other",
] as const;

/**
 * Whether a post shows on its event's page: approved posts do; hidden ones
 * were taken down; pending ones wait for an organizer (a future candidate
 * search adds them so; nothing publishes itself).
 */
export const eventPostStatuses = ["approved", "hidden", "pending"] as const;

/**
 * Posts about an event on social platforms, as core's posts tool
 * (core/src/posts/) stores them: the text and author at the canonical URL,
 * with images copied into the media bucket by the hourly sync from their
 * source URLs, never linked to directly.
 */
export const eventPostsTable = pgTable(
  "event_posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => eventsTable.id),
    platform: text("platform", { enum: eventPostPlatforms }).notNull(),
    /** The post's canonical URL; one row per post. */
    url: text("url").notNull().unique(),
    authorName: text("author_name").notNull(),
    authorHandle: text("author_handle"),
    authorUrl: text("author_url"),
    authorAvatarSourceUrl: text("author_avatar_source_url"),
    authorAvatar: uuid("author_avatar").references(() => imagesTable.id, {
      onDelete: "set null",
    }),
    postedAt: timestamp("posted_at", { withTimezone: true }).notNull(),
    /** Plain text. */
    text: text("text").notNull(),
    imageSourceUrl: text("image_source_url"),
    image: uuid("image").references(() => imagesTable.id, {
      onDelete: "set null",
    }),
    status: text("status", { enum: eventPostStatuses })
      .notNull()
      .default("approved"),
    addedAt: timestamp("added_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt,
  },
  (table) => [
    index("event_posts_event_id_idx").on(table.eventId),
    check(
      "event_posts_platform_check",
      sql`"platform" IN ('x', 'bluesky', 'linkedin', 'other')`,
    ),
    check(
      "event_posts_status_check",
      sql`"status" IN ('approved', 'hidden', 'pending')`,
    ),
  ],
);

/**
 * An event's schedule, in position order; `time` is as written ("1 - 7 pm",
 * "~7:00 pm"). core/migrations/0006_event_extras.ts is the same change.
 */
export const eventScheduleItemsTable = pgTable(
  "event_schedule_items",
  {
    eventId: uuid("event_id")
      .notNull()
      .references(() => eventsTable.id),
    /** Order in the event's schedule, from 0. */
    position: integer("position").notNull(),
    time: text("time").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    createdAt,
    updatedAt,
  },
  (table) => [
    primaryKey({ columns: [table.eventId, table.position] }),
    check("event_schedule_items_position_check", sql`"position" >= 0`),
  ],
);

/**
 * A row of an event's page under `label` ("Awards", "Theme"), in position
 * order; `body` is editor HTML, as talk descriptions are.
 */
export const eventNotesTable = pgTable(
  "event_notes",
  {
    eventId: uuid("event_id")
      .notNull()
      .references(() => eventsTable.id),
    /** Order among the event's notes, from 0. */
    position: integer("position").notNull(),
    label: text("label").notNull(),
    body: text("body").notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [
    primaryKey({ columns: [table.eventId, table.position] }),
    check("event_notes_position_check", sql`"position" >= 0`),
  ],
);

export type InsertEventPost = typeof eventPostsTable.$inferInsert;
export type SelectEventPost = typeof eventPostsTable.$inferSelect;

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
    /**
     * The talk's place in the evening's running order, from 0; talks without
     * one follow, in the order they were attached.
     */
    position: integer("position"),
    /** When the talk started, where it is known. */
    startsAt: timestamp("starts_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.eventId, table.talkId] }),
    check("event_talks_position_check", sql`"position" >= 0`),
  ],
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

/**
 * Planning: ideas for evenings, speakers we'd like on stage and when they're
 * free, companies we'd like to host, and notes on the people and companies
 * we know. The rows are private; only this schema is public. It lives in its
 * own Postgres schema, which no role the site reads or syncs with may use,
 * so no grant on the tables in `public` can ever reach it.
 * core/migrations/0012_planning.ts is the same change.
 */
export const planningSchema = pgSchema("planning");

/** core's isTopic (core/src/lockup.ts) for `column`, as events_topic_check holds events.topic to it. */
const topicRule = (column: string) =>
  sql.raw(`char_length("${column}") <= 24
    AND "${column}" IS NFC NORMALIZED
    AND "${column}" = lower("${column}" COLLATE "pg_c_utf8")
    AND strpos("${column}", 'all things') = 0
    AND "${column}" COLLATE "pg_c_utf8" ~ '^[[:alpha:][:digit:]](?:[[:alpha:][:digit:].&+#'']|(?<=[^ ]) (?=[^ ])|(?<=[[:alpha:][:digit:]])-(?=[[:alpha:][:digit:]]))*$'`);

const planningCreatedAt = timestamp("created_at", { withTimezone: true })
  .notNull()
  .defaultNow();

const planningUpdatedAt = timestamp("updated_at", { withTimezone: true })
  .notNull()
  .defaultNow();

export const ideaStatuses = [
  "idea",
  "drafting",
  "scheduled",
  "dropped",
] as const;

export const wantedSpeakerStatuses = [
  "wanted",
  "asked",
  "confirmed",
  "declined",
] as const;

export const hostProspectStatuses = [
  "prospect",
  "asked",
  "confirmed",
  "declined",
] as const;

export const availabilityKinds = ["available", "unavailable"] as const;

/** Someone we know who has no profile yet. */
export const planningContactsTable = planningSchema.table(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    email: text("email"),
    url: text("url"),
    /** Where they work, when it's a company we know. */
    sponsorId: uuid("sponsor_id").references(() => hostsTable.id),
    createdAt: planningCreatedAt,
    updatedAt: planningUpdatedAt,
  },
  () => [
    check("contacts_name_check", sql`btrim("name") <> ''`),
    check(
      "contacts_email_check",
      sql`"email" ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'`,
    ),
    check("contacts_url_check", sql`"url" ~ '^https://[^[:space:]]+$'`),
  ],
);

/** An evening we might put on, from a first thought to a scheduled event. */
export const planningIdeasTable = planningSchema.table(
  "ideas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    pitch: text("pitch").notNull(),
    program: text("program", { enum: eventPrograms }).notNull(),
    topic: text("topic"),
    status: text("status", { enum: ideaStatuses }).notNull().default("idea"),
    /**
     * The draft evening it became, then the event itself. Deleting that
     * event is refused until the idea lets go of it.
     */
    eventId: uuid("event_id")
      .unique()
      .references(() => eventsTable.id),
    /** A past evening it builds on. */
    inspiredByEventId: uuid("inspired_by_event_id").references(
      () => eventsTable.id,
      { onDelete: "set null" },
    ),
    createdAt: planningCreatedAt,
    updatedAt: planningUpdatedAt,
  },
  () => [
    check("ideas_title_check", sql`btrim("title") <> ''`),
    check("ideas_pitch_check", sql`btrim("pitch") <> ''`),
    check(
      "ideas_program_check",
      sql`"program" IN ('talks', 'open-floor', 'social', 'hackathon')`,
    ),
    check("ideas_topic_check", topicRule("topic")),
    check(
      "ideas_status_check",
      sql`"status" IN ('idea', 'drafting', 'scheduled', 'dropped')`,
    ),
    check(
      "ideas_scheduled_event_check",
      sql`"status" <> 'scheduled' OR "event_id" IS NOT NULL`,
    ),
  ],
);

/** A speaker we'd like on stage: someone with a profile, or a contact. */
export const planningWantedSpeakersTable = planningSchema.table(
  "wanted_speakers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id")
      .unique()
      .references(() => profilesTable.id),
    contactId: uuid("contact_id")
      .unique()
      .references(() => planningContactsTable.id),
    status: text("status", { enum: wantedSpeakerStatuses })
      .notNull()
      .default("wanted"),
    note: text("note"),
    createdAt: planningCreatedAt,
    updatedAt: planningUpdatedAt,
  },
  () => [
    check(
      "wanted_speakers_person_check",
      sql`num_nonnulls("profile_id", "contact_id") = 1`,
    ),
    check(
      "wanted_speakers_status_check",
      sql`"status" IN ('wanted', 'asked', 'confirmed', 'declined')`,
    ),
  ],
);

/** What a wanted speaker could speak about, as event topics are written. */
export const planningWantedSpeakerTopicsTable = planningSchema.table(
  "wanted_speaker_topics",
  {
    wantedSpeakerId: uuid("wanted_speaker_id")
      .notNull()
      .references(() => planningWantedSpeakersTable.id, {
        onDelete: "cascade",
      }),
    topic: text("topic").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.wantedSpeakerId, table.topic] }),
    index("wanted_speaker_topics_topic_idx").on(table.topic),
    check("wanted_speaker_topics_topic_check", topicRule("topic")),
  ],
);

/**
 * When a wanted speaker is free, or isn't: dates (inclusive, either end
 * open) and the words they used ("free after Dec").
 */
export const planningAvailabilityTable = planningSchema.table(
  "availability",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    wantedSpeakerId: uuid("wanted_speaker_id")
      .notNull()
      .references(() => planningWantedSpeakersTable.id, {
        onDelete: "cascade",
      }),
    kind: text("kind", { enum: availabilityKinds })
      .notNull()
      .default("available"),
    startsOn: date("starts_on"),
    endsOn: date("ends_on"),
    note: text("note"),
    createdAt: planningCreatedAt,
  },
  (table) => [
    index("availability_wanted_speaker_id_idx").on(table.wantedSpeakerId),
    check(
      "availability_kind_check",
      sql`"kind" IN ('available', 'unavailable')`,
    ),
    check("availability_order_check", sql`"starts_on" <= "ends_on"`),
    check(
      "availability_said_check",
      sql`num_nonnulls("starts_on", "ends_on", "note") > 0`,
    ),
  ],
);

/** A company we'd like to host an evening: one we know, or a new name. */
export const planningHostProspectsTable = planningSchema.table(
  "host_prospects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sponsorId: uuid("sponsor_id")
      .unique()
      .references(() => hostsTable.id),
    /** A new company's name, unique in any case. */
    companyName: text("company_name"),
    contactId: uuid("contact_id").references(() => planningContactsTable.id),
    status: text("status", { enum: hostProspectStatuses })
      .notNull()
      .default("prospect"),
    note: text("note"),
    createdAt: planningCreatedAt,
    updatedAt: planningUpdatedAt,
  },
  (table) => [
    uniqueIndex("host_prospects_company_name_unique").on(
      sql`lower(${table.companyName})`,
    ),
    check(
      "host_prospects_company_check",
      sql`num_nonnulls("sponsor_id", "company_name") = 1`,
    ),
    check(
      "host_prospects_company_name_check",
      sql`btrim("company_name") <> ''`,
    ),
    check(
      "host_prospects_status_check",
      sql`"status" IN ('prospect', 'asked', 'confirmed', 'declined')`,
    ),
  ],
);

/** A note on a person or a company we know, in an organizer's words. */
export const planningNotesTable = planningSchema.table(
  "notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id").references(() => profilesTable.id),
    sponsorId: uuid("sponsor_id").references(() => hostsTable.id),
    contactId: uuid("contact_id").references(() => planningContactsTable.id),
    body: text("body").notNull(),
    /** Who wrote it, as they sign. */
    author: text("author"),
    createdAt: planningCreatedAt,
  },
  (table) => [
    index("notes_profile_id_idx").on(table.profileId),
    index("notes_sponsor_id_idx").on(table.sponsorId),
    index("notes_contact_id_idx").on(table.contactId),
    check(
      "notes_subject_check",
      sql`num_nonnulls("profile_id", "sponsor_id", "contact_id") = 1`,
    ),
    check("notes_body_check", sql`btrim("body") <> ''`),
    check("notes_author_check", sql`btrim("author") <> ''`),
  ],
);

/**
 * Each evening's post we sent to a Discord webhook or to X, claimed before
 * it is sent so it goes out once. core/migrations/0021_sent_posts.ts and
 * 0022_x_sent_posts.ts are the same changes.
 */
/**
 * Who organizes, co-hosts and MCs an evening that isn't published yet,
 * kept private in planning until publishing copies it to event_people.
 * core/migrations/0024_draft_lineup.ts is the same change.
 */
export const planningDraftPeopleTable = planningSchema.table(
  "draft_people",
  {
    eventId: uuid("event_id")
      .notNull()
      .references(() => eventsTable.id),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profilesTable.id),
    role: text("role", { enum: eventPersonRoles }).notNull(),
    /** Order among the evening's people in the same role, from 0. */
    position: integer("position").notNull(),
    createdAt: planningCreatedAt,
  },
  (table) => [
    primaryKey({ columns: [table.eventId, table.profileId, table.role] }),
    check(
      "draft_people_role_check",
      sql`"role" IN ('organizer', 'co-host', 'mc')`,
    ),
    check("draft_people_position_check", sql`"position" >= 0`),
  ],
);

/**
 * Each draft's publish, claimed before it starts so two never overlap,
 * then published once Luma says so. While it is claimed or published, the
 * draft's private lineup can't change. core/migrations/0024_draft_lineup.ts
 * is the same change.
 */
export const planningPublishesTable = planningSchema.table(
  "publishes",
  {
    eventId: uuid("event_id")
      .primaryKey()
      .references(() => eventsTable.id),
    status: text("status", { enum: ["publishing", "published"] }).notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  () => [
    check(
      "publishes_status_check",
      sql`"status" IN ('publishing', 'published')`,
    ),
    check(
      "publishes_published_check",
      sql`("status" = 'published') = ("published_at" IS NOT NULL)`,
    ),
  ],
);

/**
 * The talks of an evening that isn't published yet, a panel or fireside
 * included, kept private in planning: the people on them may not have said
 * yes, or have no profile yet. core/migrations/0027_draft_talks.ts is the
 * same change.
 */
export const planningDraftTalksTable = planningSchema.table(
  "draft_talks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => eventsTable.id),
    /** Its place in the evening's running order, from 1. */
    position: integer("position").notNull(),
    kind: text("kind", { enum: ["talk", "panel", "fireside"] }).notNull(),
    title: text("title").notNull(),
    description: text("description"),
    createdAt: planningCreatedAt,
  },
  (table) => [
    unique("draft_talks_event_id_position_unique").on(
      table.eventId,
      table.position,
    ),
    unique("draft_talks_event_id_title_unique").on(table.eventId, table.title),
    check("draft_talks_position_check", sql`"position" > 0`),
    check(
      "draft_talks_kind_check",
      sql`"kind" IN ('talk', 'panel', 'fireside')`,
    ),
    check(
      "draft_talks_title_check",
      sql`btrim("title") <> '' AND char_length("title") <= 120`,
    ),
    check(
      "draft_talks_description_check",
      sql`btrim("description") <> '' AND char_length("description") <= 4000`,
    ),
  ],
);

/**
 * Who is on a draft talk, by the wanted speaker planning keeps for them,
 * so whether they've said yes is that record's status, never kept twice.
 * core/migrations/0027_draft_talks.ts is the same change.
 */
export const planningDraftTalkPeopleTable = planningSchema.table(
  "draft_talk_people",
  {
    draftTalkId: uuid("draft_talk_id")
      .notNull()
      .references(() => planningDraftTalksTable.id),
    wantedSpeakerId: uuid("wanted_speaker_id")
      .notNull()
      .references(() => planningWantedSpeakersTable.id),
    role: text("role", {
      enum: ["speaker", "panelist", "moderator"],
    }).notNull(),
    /** Order on the talk, from 0. */
    position: integer("position").notNull(),
    createdAt: planningCreatedAt,
  },
  (table) => [
    primaryKey({ columns: [table.draftTalkId, table.wantedSpeakerId] }),
    unique("draft_talk_people_draft_talk_id_position_unique").on(
      table.draftTalkId,
      table.position,
    ),
    check(
      "draft_talk_people_role_check",
      sql`"role" IN ('speaker', 'panelist', 'moderator')`,
    ),
    check("draft_talk_people_position_check", sql`"position" >= 0`),
  ],
);

/**
 * What happened to a draft evening: one row per studio write that touched
 * it, made in the write's own transaction, with who (ALLTHINGS_ACTOR, a
 * declared label), the command, a summary and what changed. Append-only,
 * and never a secret or an email. core/migrations/0028_draft_log.ts is the
 * same change, and its triggers are appended to the generated SQL.
 */
export const planningDraftLogTable = planningSchema.table(
  "draft_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Its evening; no foreign key: kept even when the evening goes. */
    eventId: uuid("event_id").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    actor: text("actor").notNull(),
    command: text("command").notNull(),
    summary: text("summary").notNull(),
    payload: jsonb("payload")
      .notNull()
      .default(sql`'{}'::jsonb`),
  },
  (table) => [
    index("draft_log_event_id_at_idx").on(table.eventId, table.at),
    check(
      "draft_log_actor_check",
      sql`"actor" ~ '^[a-z0-9][a-z0-9._-]{0,31}(/[a-z0-9][a-z0-9._-]{0,31})?$'`,
    ),
    check(
      "draft_log_command_check",
      sql`char_length("command") <= 80 AND "command" ~ '^[a-z][a-z0-9:-]*( [a-z0-9:-]+)*$'`,
    ),
    check(
      "draft_log_summary_check",
      sql`btrim("summary") <> '' AND char_length("summary") <= 500 AND "summary" !~* '[a-z0-9._%+-]+@[a-z0-9-]+([.][a-z0-9-]+)+'`,
    ),
    check(
      "draft_log_payload_check",
      sql`jsonb_typeof("payload") = 'object' AND octet_length("payload"::text) <= 8000 AND "payload"::text !~* '[a-z0-9._%+-]+@[a-z0-9-]+([.][a-z0-9-]+)+'`,
    ),
  ],
);

/**
 * A note, a decision or a question about a draft evening, each written
 * once; only an open question is ever changed, to resolve it.
 * core/migrations/0028_draft_log.ts is the same change.
 */
export const planningDraftNotesTable = planningSchema.table(
  "draft_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Its evening; no foreign key: kept even when the evening goes. */
    eventId: uuid("event_id").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    actor: text("actor").notNull(),
    kind: text("kind", { enum: ["note", "decision", "question"] }).notNull(),
    text: text("text").notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [
    index("draft_notes_event_id_at_idx").on(table.eventId, table.at),
    check(
      "draft_notes_actor_check",
      sql`"actor" ~ '^[a-z0-9][a-z0-9._-]{0,31}(/[a-z0-9][a-z0-9._-]{0,31})?$'`,
    ),
    check(
      "draft_notes_kind_check",
      sql`"kind" IN ('note', 'decision', 'question')`,
    ),
    check(
      "draft_notes_text_check",
      sql`btrim("text") <> '' AND char_length("text") <= 2000`,
    ),
    check(
      "draft_notes_resolved_check",
      sql`"resolved_at" IS NULL OR ("kind" = 'question' AND "resolved_at" >= "at")`,
    ),
  ],
);

export const planningSentPostsTable = planningSchema.table(
  "sent_posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    channel: text("channel", { enum: ["discord", "x"] }).notNull(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => eventsTable.id),
    moment: text("moment", { enum: ["announce", "dayOf", "recap"] }).notNull(),
    /** The approval token of the exact text sent. */
    token: text("token").notNull(),
    /** The exact text approved, so a post found later can be checked against it. */
    body: text("body"),
    status: text("status", { enum: ["sending", "unanswered", "sent"] })
      .notNull()
      .default("sending"),
    messageId: text("message_id"),
    url: text("url"),
    claimedAt: timestamp("claimed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (table) => [
    unique("sent_posts_channel_event_id_moment_unique").on(
      table.channel,
      table.eventId,
      table.moment,
    ),
    check("sent_posts_channel_check", sql`"channel" IN ('discord', 'x')`),
    check(
      "sent_posts_moment_check",
      sql`"moment" IN ('announce', 'dayOf', 'recap')`,
    ),
    check("sent_posts_token_check", sql`"token" ~ '^[0-9a-f]{16}$'`),
    check(
      "sent_posts_status_check",
      sql`"status" IN ('sending', 'unanswered', 'sent')`,
    ),
    check(
      "sent_posts_sent_check",
      sql`("status" = 'sent') = ("message_id" IS NOT NULL AND "url" IS NOT NULL AND "sent_at" IS NOT NULL)`,
    ),
    check("sent_posts_url_check", sql`"url" ~ '^https://[^[:space:]]+$'`),
  ],
);

/**
 * Collaborating on a draft evening: who an organizer invites to help, what
 * they see, and what they hand in, with row security on every table.
 * core/migrations/0026_draft_collaboration.ts is the same change, and says
 * what each table and policy is for. The policies ask the `collab_*`
 * functions, which drizzle can't declare: migrations/0038_draft_collaboration.sql creates them by
 * hand, before the policies.
 */
export const collaboratorRoles = [
  "viewer",
  "commenter",
  "round_host",
  "venue",
  "organizer",
] as const;

const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => "bytea",
});

const everyoneRoles = sql.raw(
  `ARRAY['viewer', 'commenter', 'round_host', 'venue']::text[]`,
);
const writerRoles = sql.raw(
  `ARRAY['commenter', 'round_host', 'venue']::text[]`,
);
const organizerRoles = sql.raw(`ARRAY['organizer']::text[]`);
const venueRoles = sql.raw(`ARRAY['venue']::text[]`);

/** An evening's rounds, for the hosts who write them. */
export const planningRoundsTable = planningSchema.table(
  "rounds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => eventsTable.id),
    position: integer("position").notNull(),
    title: text("title").notNull(),
    questions: integer("questions").notNull().default(8),
    backups: integer("backups").notNull().default(1),
    createdAt: planningCreatedAt,
  },
  (table) => [
    unique("rounds_id_event_id_unique").on(table.id, table.eventId),
    unique("rounds_event_id_position_unique").on(table.eventId, table.position),
    check("rounds_position_check", sql`"position" > 0`),
    check(
      "rounds_title_check",
      sql`btrim("title") <> '' AND char_length("title") <= 80`,
    ),
    check("rounds_questions_check", sql`"questions" BETWEEN 1 AND 20`),
    check("rounds_backups_check", sql`"backups" BETWEEN 0 AND 5`),
    pgPolicy("rounds_select", {
      for: "select",
      using: sql`planning.collab_has_role("event_id", ${everyoneRoles})`,
    }),
  ],
);

/** Who may help with an evening, by the email they sign in to Access with. */
export const planningCollaboratorsTable = planningSchema
  .table(
    "collaborators",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      eventId: uuid("event_id")
        .notNull()
        .references(() => eventsTable.id),
      email: text("email").notNull(),
      name: text("name").notNull(),
      role: text("role", { enum: collaboratorRoles }).notNull(),
      roundId: uuid("round_id"),
      invitedAt: timestamp("invited_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
      expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
      revokedAt: timestamp("revoked_at", { withTimezone: true }),
    },
    (table) => [
      unique("collaborators_id_event_id_unique").on(table.id, table.eventId),
      foreignKey({
        name: "collaborators_round_fk",
        columns: [table.roundId, table.eventId],
        foreignColumns: [planningRoundsTable.id, planningRoundsTable.eventId],
      }),
      uniqueIndex("collaborators_active_unique")
        .on(table.eventId, table.email)
        .where(sql`"revoked_at" IS NULL`),
      index("collaborators_email_idx")
        .on(table.email)
        .where(sql`"revoked_at" IS NULL`),
      check(
        "collaborators_email_check",
        sql`"email" = lower("email") AND char_length("email") <= 254 AND "email" ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'`,
      ),
      check(
        "collaborators_name_check",
        sql`btrim("name") <> '' AND char_length("name") <= 80`,
      ),
      check(
        "collaborators_role_check",
        sql`"role" IN ('viewer', 'commenter', 'round_host', 'venue', 'organizer')`,
      ),
      check(
        "collaborators_round_check",
        sql`("role" = 'round_host') = ("round_id" IS NOT NULL)`,
      ),
      check("collaborators_expires_check", sql`"expires_at" > "invited_at"`),
      check("collaborators_revoked_check", sql`"revoked_at" >= "invited_at"`),
    ],
  )
  .enableRLS();

/** The brief, a section at a time, each for the roles in its audiences. */
export const planningBriefSectionsTable = planningSchema.table(
  "brief_sections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => eventsTable.id),
    position: integer("position").notNull(),
    heading: text("heading").notNull(),
    body: text("body").notNull(),
    audiences: text("audiences").array().notNull(),
    updatedAt: planningUpdatedAt,
  },
  (table) => [
    unique("brief_sections_id_event_id_unique").on(table.id, table.eventId),
    unique("brief_sections_event_id_position_unique").on(
      table.eventId,
      table.position,
    ),
    check("brief_sections_position_check", sql`"position" > 0`),
    check(
      "brief_sections_heading_check",
      sql`btrim("heading") <> '' AND char_length("heading") <= 120`,
    ),
    check(
      "brief_sections_body_check",
      sql`btrim("body") <> '' AND char_length("body") <= 20000`,
    ),
    check(
      "brief_sections_audiences_check",
      sql`cardinality("audiences") > 0 AND "audiences" <@ ARRAY['viewer', 'commenter', 'round_host', 'venue', 'organizer']::text[]`,
    ),
    pgPolicy("brief_sections_select", {
      for: "select",
      using: sql`planning.collab_has_role("event_id", ${organizerRoles}) OR EXISTS (
        SELECT 1 FROM planning.collab_memberships() m
        WHERE m.event_id = "brief_sections"."event_id" AND m.role = ANY ("brief_sections"."audiences")
      )`,
    }),
  ],
);

/** What someone has to do, by when: everyone, a role, or one collaborator. */
export const planningTasksTable = planningSchema.table(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => eventsTable.id),
    title: text("title").notNull(),
    dueOn: date("due_on"),
    role: text("role", { enum: collaboratorRoles }),
    collaboratorId: uuid("collaborator_id"),
    doneAt: timestamp("done_at", { withTimezone: true }),
    createdAt: planningCreatedAt,
  },
  (table) => [
    foreignKey({
      name: "tasks_collaborator_fk",
      columns: [table.collaboratorId, table.eventId],
      foreignColumns: [
        planningCollaboratorsTable.id,
        planningCollaboratorsTable.eventId,
      ],
    }),
    index("tasks_event_id_idx").on(table.eventId),
    check(
      "tasks_title_check",
      sql`btrim("title") <> '' AND char_length("title") <= 200`,
    ),
    check(
      "tasks_role_check",
      sql`"role" IN ('viewer', 'commenter', 'round_host', 'venue', 'organizer')`,
    ),
    check("tasks_for_check", sql`num_nonnulls("role", "collaborator_id") <= 1`),
    pgPolicy("tasks_select", {
      for: "select",
      using: sql`planning.collab_has_role("event_id", ${organizerRoles}) OR EXISTS (
        SELECT 1 FROM planning.collab_memberships() m
        WHERE m.event_id = "tasks"."event_id" AND (
          m.collaborator_id = "tasks"."collaborator_id"
          OR m.role = "tasks"."role"
          OR ("tasks"."role" IS NULL AND "tasks"."collaborator_id" IS NULL)
        )
      )`,
    }),
  ],
);

/** What the venue is asked to confirm. */
export const planningLogisticsItemsTable = planningSchema.table(
  "logistics_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => eventsTable.id),
    position: integer("position").notNull(),
    label: text("label").notNull(),
    detail: text("detail"),
    createdAt: planningCreatedAt,
  },
  (table) => [
    unique("logistics_items_id_event_id_unique").on(table.id, table.eventId),
    unique("logistics_items_event_id_position_unique").on(
      table.eventId,
      table.position,
    ),
    check("logistics_items_position_check", sql`"position" > 0`),
    check(
      "logistics_items_label_check",
      sql`btrim("label") <> '' AND char_length("label") <= 120`,
    ),
    check(
      "logistics_items_detail_check",
      sql`btrim("detail") <> '' AND char_length("detail") <= 1000`,
    ),
    pgPolicy("logistics_items_select", {
      for: "select",
      using: sql`planning.collab_has_role("event_id", ${venueRoles})`,
    }),
  ],
);

/** The venue's answer to an item, each a new row. */
export const planningLogisticsConfirmationsTable = planningSchema.table(
  "logistics_confirmations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id").notNull(),
    itemId: uuid("item_id").notNull(),
    collaboratorId: uuid("collaborator_id").notNull(),
    answer: text("answer", { enum: ["yes", "no", "unsure"] }).notNull(),
    note: text("note"),
    createdAt: planningCreatedAt,
  },
  (table) => [
    foreignKey({
      name: "logistics_confirmations_item_fk",
      columns: [table.itemId, table.eventId],
      foreignColumns: [
        planningLogisticsItemsTable.id,
        planningLogisticsItemsTable.eventId,
      ],
    }),
    foreignKey({
      name: "logistics_confirmations_collaborator_fk",
      columns: [table.collaboratorId, table.eventId],
      foreignColumns: [
        planningCollaboratorsTable.id,
        planningCollaboratorsTable.eventId,
      ],
    }),
    index("logistics_confirmations_item_id_created_at_idx").on(
      table.itemId,
      table.createdAt,
    ),
    check(
      "logistics_confirmations_answer_check",
      sql`"answer" IN ('yes', 'no', 'unsure')`,
    ),
    check(
      "logistics_confirmations_note_check",
      sql`btrim("note") <> '' AND char_length("note") <= 1000`,
    ),
    pgPolicy("logistics_confirmations_select", {
      for: "select",
      using: sql`planning.collab_has_role("event_id", ${venueRoles})`,
    }),
    pgPolicy("logistics_confirmations_insert", {
      for: "insert",
      withCheck: sql`EXISTS (
        SELECT 1 FROM planning.collab_memberships() m
        WHERE m.collaborator_id = "logistics_confirmations"."collaborator_id"
          AND m.event_id = "logistics_confirmations"."event_id"
          AND m.role IN ('venue', 'organizer')
      )`,
    }),
  ],
);

/** A round host's questions and answer key, sealed by the Worker, each save a new row. */
export const planningRoundSubmissionsTable = planningSchema.table(
  "round_submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id").notNull(),
    roundId: uuid("round_id").notNull(),
    collaboratorId: uuid("collaborator_id").notNull(),
    stage: text("stage", { enum: ["draft", "final"] }).notNull(),
    keyId: text("key_id").notNull(),
    nonce: bytea("nonce").notNull(),
    ciphertext: bytea("ciphertext").notNull(),
    createdAt: planningCreatedAt,
  },
  (table) => [
    foreignKey({
      name: "round_submissions_round_fk",
      columns: [table.roundId, table.eventId],
      foreignColumns: [planningRoundsTable.id, planningRoundsTable.eventId],
    }),
    foreignKey({
      name: "round_submissions_collaborator_fk",
      columns: [table.collaboratorId, table.eventId],
      foreignColumns: [
        planningCollaboratorsTable.id,
        planningCollaboratorsTable.eventId,
      ],
    }),
    index("round_submissions_round_id_created_at_idx").on(
      table.roundId,
      table.createdAt,
    ),
    check("round_submissions_stage_check", sql`"stage" IN ('draft', 'final')`),
    check(
      "round_submissions_key_id_check",
      sql`"key_id" ~ '^[a-z0-9-]{1,32}$'`,
    ),
    check("round_submissions_nonce_check", sql`octet_length("nonce") = 12`),
    check(
      "round_submissions_ciphertext_check",
      sql`octet_length("ciphertext") BETWEEN 17 AND 65552`,
    ),
    pgPolicy("round_submissions_select", {
      for: "select",
      using: sql`planning.collab_has_role("event_id", ${organizerRoles}) OR planning.collab_hosts("round_id")`,
    }),
    pgPolicy("round_submissions_insert", {
      for: "insert",
      withCheck: sql`EXISTS (
        SELECT 1 FROM planning.collab_memberships() m
        WHERE m.collaborator_id = "round_submissions"."collaborator_id"
          AND m.event_id = "round_submissions"."event_id"
          AND m.role = 'round_host'
          AND m.round_id = "round_submissions"."round_id"
      )`,
    }),
  ],
);

/** An organizer's decision on a round submission or a logistics answer. */
export const planningReviewsTable = planningSchema.table(
  "reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roundSubmissionId: uuid("round_submission_id").references(
      () => planningRoundSubmissionsTable.id,
    ),
    logisticsConfirmationId: uuid("logistics_confirmation_id").references(
      () => planningLogisticsConfirmationsTable.id,
    ),
    decision: text("decision", {
      enum: ["accepted", "rejected", "changes_requested"],
    }).notNull(),
    note: text("note"),
    reviewer: text("reviewer").notNull(),
    createdAt: planningCreatedAt,
  },
  (table) => [
    index("reviews_round_submission_id_idx").on(table.roundSubmissionId),
    index("reviews_logistics_confirmation_id_idx").on(
      table.logisticsConfirmationId,
    ),
    check(
      "reviews_subject_check",
      sql`num_nonnulls("round_submission_id", "logistics_confirmation_id") = 1`,
    ),
    check(
      "reviews_decision_check",
      sql`"decision" IN ('accepted', 'rejected', 'changes_requested')`,
    ),
    check(
      "reviews_note_check",
      sql`btrim("note") <> '' AND char_length("note") <= 2000`,
    ),
    check(
      "reviews_reviewer_check",
      sql`btrim("reviewer") <> '' AND char_length("reviewer") <= 80`,
    ),
    pgPolicy("reviews_select", {
      for: "select",
      using: sql`"round_submission_id" IN (SELECT s.id FROM planning.round_submissions s)
        OR "logistics_confirmation_id" IN (SELECT l.id FROM planning.logistics_confirmations l)`,
    }),
  ],
);

/** A comment on the evening, a brief section or a round. */
export const planningCommentsTable = planningSchema.table(
  "comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => eventsTable.id),
    collaboratorId: uuid("collaborator_id"),
    authorName: text("author_name").notNull(),
    authorEmail: text("author_email").notNull(),
    sectionId: uuid("section_id"),
    roundId: uuid("round_id"),
    body: text("body").notNull(),
    createdAt: planningCreatedAt,
    hiddenAt: timestamp("hidden_at", { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      name: "comments_collaborator_fk",
      columns: [table.collaboratorId, table.eventId],
      foreignColumns: [
        planningCollaboratorsTable.id,
        planningCollaboratorsTable.eventId,
      ],
    }),
    foreignKey({
      name: "comments_section_fk",
      columns: [table.sectionId, table.eventId],
      foreignColumns: [
        planningBriefSectionsTable.id,
        planningBriefSectionsTable.eventId,
      ],
    }),
    foreignKey({
      name: "comments_round_fk",
      columns: [table.roundId, table.eventId],
      foreignColumns: [planningRoundsTable.id, planningRoundsTable.eventId],
    }),
    index("comments_event_id_created_at_idx").on(
      table.eventId,
      table.createdAt,
    ),
    check(
      "comments_author_name_check",
      sql`btrim("author_name") <> '' AND char_length("author_name") <= 80`,
    ),
    check(
      "comments_author_email_check",
      sql`"author_email" = lower("author_email") AND char_length("author_email") <= 254`,
    ),
    check(
      "comments_target_check",
      sql`num_nonnulls("section_id", "round_id") <= 1`,
    ),
    check(
      "comments_body_check",
      sql`btrim("body") <> '' AND char_length("body") <= 2000`,
    ),
    pgPolicy("comments_select", {
      for: "select",
      using: sql`"hidden_at" IS NULL AND (
        planning.collab_has_role("event_id", ${organizerRoles}) OR (
          planning.collab_has_role("event_id", ${everyoneRoles})
          AND ("round_id" IS NULL OR planning.collab_hosts("round_id"))
          AND ("section_id" IS NULL OR "section_id" IN (SELECT b.id FROM planning.brief_sections b))
        )
      )`,
    }),
    pgPolicy("comments_insert", {
      for: "insert",
      withCheck: sql`"hidden_at" IS NULL
        AND "author_email" = planning.collab_email()
        AND planning.collab_has_role("event_id", ${writerRoles})
        AND ("round_id" IS NULL OR planning.collab_has_role("event_id", ${organizerRoles}) OR planning.collab_hosts("round_id"))
        AND ("section_id" IS NULL OR "section_id" IN (SELECT b.id FROM planning.brief_sections b))
        AND (
          ("collaborator_id" IS NULL AND planning.collab_is_organizer())
          OR "collaborator_id" IN (
            SELECT m.collaborator_id FROM planning.collab_memberships() m
            WHERE m.event_id = "comments"."event_id"
          )
        )`,
    }),
  ],
);

/** Every collaborator action, refused ones included; kept when its evening goes. */
export const planningCollabAuditTable = planningSchema.table(
  "collab_audit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    actorEmail: text("actor_email").notNull(),
    eventId: uuid("event_id"),
    action: text("action").notNull(),
    targetId: uuid("target_id"),
    outcome: text("outcome", {
      enum: ["ok", "refused", "invalid", "limited"],
    }).notNull(),
    requestId: text("request_id"),
    detail: text("detail"),
  },
  (table) => [
    index("collab_audit_actor_email_at_idx").on(table.actorEmail, table.at),
    index("collab_audit_event_id_at_idx").on(table.eventId, table.at),
    check(
      "collab_audit_actor_email_check",
      sql`"actor_email" = lower("actor_email") AND char_length("actor_email") <= 254`,
    ),
    check(
      "collab_audit_action_check",
      sql`char_length("action") <= 48 AND "action" ~ '^[a-z_]+([.][a-z_]+)*$'`,
    ),
    check(
      "collab_audit_outcome_check",
      sql`"outcome" IN ('ok', 'refused', 'invalid', 'limited')`,
    ),
    check(
      "collab_audit_request_id_check",
      sql`char_length("request_id") <= 64`,
    ),
    check("collab_audit_detail_check", sql`char_length("detail") <= 500`),
    pgPolicy("collab_audit_insert", {
      for: "insert",
      withCheck: sql`"actor_email" = planning.collab_email()`,
    }),
  ],
);

/** What kind of stage a talk given elsewhere was on. */
export const externalTalkKinds = [
  "conference",
  "meetup",
  "podcast",
  "video",
  "workshop",
] as const;

/**
 * Talks people gave elsewhere: at conferences, other meetups, on podcasts
 * and in videos, sourced like the lineups (core/backfill/external-talks.json).
 * core/migrations/0016_external_talks.ts is the same change.
 */
export const externalTalksTable = pgTable(
  "external_talks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profilesTable.id),
    title: text("title").notNull(),
    /** The conference, meetup, podcast or channel it was given at. */
    eventName: text("event_name").notNull(),
    kind: text("kind", { enum: externalTalkKinds }).notNull(),
    givenOn: date("given_on", { mode: "string" }).notNull(),
    /** The talk's, episode's or event's page. */
    url: text("url"),
    /** Its recording. */
    videoUrl: text("video_url"),
    /** Where the facts were read, and on what day. */
    sourceUrl: text("source_url").notNull(),
    readOn: date("read_on", { mode: "string" }).notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("external_talks_profile_id_idx").on(table.profileId),
    unique("external_talks_profile_id_title_given_on_unique").on(
      table.profileId,
      table.title,
      table.givenOn,
    ),
    check(
      "external_talks_kind_check",
      sql`"kind" IN ('conference', 'meetup', 'podcast', 'video', 'workshop')`,
    ),
    check("external_talks_url_check", sql`"url" ~ '^https://'`),
    check("external_talks_video_url_check", sql`"video_url" ~ '^https://'`),
    check("external_talks_source_url_check", sql`"source_url" ~ '^https://'`),
  ],
);
