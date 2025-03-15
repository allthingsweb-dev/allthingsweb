import {
  pgTable,
  text,
  uuid,
  pgEnum,
  boolean,
  timestamp,
  integer,
  primaryKey,
} from "drizzle-orm/pg-core";

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

export const sponsorsTable = pgTable("sponsors", {
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

export type InsertSponsor = typeof sponsorsTable.$inferInsert;
export type SelectSponsor = typeof sponsorsTable.$inferSelect;

export const profileTypeEnum = pgEnum("profile_type", ["organizer", "member"]);

export const profilesTable = pgTable("profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  title: text("title").notNull(),
  image: uuid("image").references(() => imagesTable.id, {
    onDelete: "set null",
  }),
  twitterHandle: text("twitter_handle"),
  blueskyHandle: text("bluesky_handle"),
  linkedinHandle: text("linkedin_handle"),
  bio: text("bio").notNull(),
  profileType: profileTypeEnum("profile_type").notNull(),
  createdAt,
  updatedAt,
});

export type InsertProfile = typeof profilesTable.$inferInsert;
export type SelectProfile = typeof profilesTable.$inferSelect;

export const talksTable = pgTable("talks", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  createdAt,
  updatedAt,
});

export const talkSpeakersTable = pgTable("talk_speakers", {
  talkId: uuid("talk_id")
    .notNull()
    .references(() => talksTable.id, { onDelete: "cascade" }),
  speakerId: uuid("speaker_id")
    .notNull()
    .references(() => profilesTable.id, { onDelete: "cascade" }),
  createdAt,
  updatedAt,
});

export type InsertTalk = typeof talksTable.$inferInsert;
export type SelectTalk = typeof talksTable.$inferSelect;
export type InsertTalkSpeaker = typeof talkSpeakersTable.$inferInsert;
export type SelectTalkSpeaker = typeof talkSpeakersTable.$inferSelect;

export const eventsTable = pgTable("events", {
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
});

export const eventSponsorsTable = pgTable("event_sponsors", {
  eventId: uuid("event_id")
    .notNull()
    .references(() => eventsTable.id, { onDelete: "cascade" }),
  sponsorId: uuid("sponsor_id")
    .notNull()
    .references(() => sponsorsTable.id, { onDelete: "cascade" }),
  createdAt,
  updatedAt,
});

export const eventTalksTable = pgTable("event_talks", {
  eventId: uuid("event_id")
    .notNull()
    .references(() => eventsTable.id, { onDelete: "cascade" }),
  talkId: uuid("talk_id")
    .notNull()
    .references(() => talksTable.id, { onDelete: "cascade" }),
  createdAt,
  updatedAt,
});

export const eventImagesTable = pgTable("event_images", {
  eventId: uuid("event_id")
    .notNull()
    .references(() => eventsTable.id, { onDelete: "cascade" }),
  imageId: uuid("image_id")
    .notNull()
    .references(() => imagesTable.id, { onDelete: "cascade" }),
  createdAt,
  updatedAt,
}, (table) => {
  return {
    pk: primaryKey({ columns: [table.eventId, table.imageId] }),
  };
});

export type InsertEvent = typeof eventsTable.$inferInsert;
export type SelectEvent = typeof eventsTable.$inferSelect;
export type InsertEventSponsor = typeof eventSponsorsTable.$inferInsert;
export type SelectEventSponsor = typeof eventSponsorsTable.$inferSelect;
export type InsertEventTalk = typeof eventTalksTable.$inferInsert;
export type SelectEventTalk = typeof eventTalksTable.$inferSelect;
export type InsertEventImage = typeof eventImagesTable.$inferInsert;
export type SelectEventImage = typeof eventImagesTable.$inferSelect;

export const hacksTable = pgTable("hacks", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => eventsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  project: text("description"),
  createdAt,
  updatedAt,
});

export const hackUsersTable = pgTable("hack_users", {
  hackId: uuid("hack_id")
    .notNull()
    .references(() => hacksTable.id, { onDelete: "cascade" }),
  clerkUserId: text("clerk_user_id").notNull(),
  createdAt,
  updatedAt,
});

export const hackVotesTable = pgTable("hack_votes", {
  id: uuid("id").primaryKey().defaultRandom(),
  hackId: uuid("hack_id")
    .notNull()
    .references(() => hacksTable.id, { onDelete: "cascade" }),
  clerkUserId: text("clerk_user_id").notNull(),
  createdAt,
  updatedAt,
});

export type InsertHack = typeof hacksTable.$inferInsert;
export type SelectHack = typeof hacksTable.$inferSelect;
export type InsertHackUser = typeof hackUsersTable.$inferInsert;
export type SelectHackUser = typeof hackUsersTable.$inferSelect;
export type InsertHackVote = typeof hackVotesTable.$inferInsert;
export type SelectHackVote = typeof hackVotesTable.$inferSelect;
