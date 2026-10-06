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
