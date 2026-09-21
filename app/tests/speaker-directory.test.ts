import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import { getSpeakerDirectory } from "../src/lib/speaker-directory";
import * as schema from "../src/lib/schema";

const client = new PGlite();
const db = drizzle(client);
const now = new Date("2026-09-21T12:00:00Z");
beforeAll(async () => {
  await client.exec("CREATE SCHEMA IF NOT EXISTS neon_auth");
  for (const statement of await generateMigration(
    generateDrizzleJson({}),
    generateDrizzleJson(schema),
  ))
    await client.exec(statement);
});
beforeEach(async () => {
  await client.exec("TRUNCATE events, profiles, talks, images CASCADE");
});
afterAll(async () => {
  await client.close();
});

async function profile(
  name: string,
  profileType: "organizer" | "member" = "member",
) {
  const [row] = await db
    .insert(schema.profilesTable)
    .values({ name, profileType, title: "Developer", bio: "" })
    .returning();
  return row;
}
async function event(
  slug: string,
  isDraft = false,
  endDate = new Date("2026-09-20T12:00:00Z"),
) {
  const [row] = await db
    .insert(schema.eventsTable)
    .values({
      slug,
      name: slug,
      isDraft,
      startDate: new Date("2026-09-19T12:00:00Z"),
      endDate,
      tagline: "",
      attendeeLimit: 0,
    })
    .returning();
  return row;
}
async function talk(speakerIds: string[], eventIds: string[]) {
  const [row] = await db
    .insert(schema.talksTable)
    .values({ title: "A shared talk", description: "" })
    .returning();
  await db
    .insert(schema.talkSpeakersTable)
    .values(speakerIds.map((speakerId) => ({ speakerId, talkId: row.id })));
  if (eventIds.length)
    await db
      .insert(schema.eventTalksTable)
      .values(eventIds.map((eventId) => ({ eventId, talkId: row.id })));
  return row;
}

test("includes organizers who spoke; excludes draft-only, future, active and unattached talks", async () => {
  const organizer = await profile("Organizer", "organizer");
  const member = await profile("Member");
  const draftSpeaker = await profile("Draft only");
  const futureSpeaker = await profile("Future only");
  const liveSpeaker = await profile("Still speaking");
  const orphan = await profile("Unattached");
  const publicEvent = await event("public");
  await talk([organizer.id, member.id], [publicEvent.id]);
  await talk([draftSpeaker.id], [(await event("draft", true)).id]);
  await talk(
    [futureSpeaker.id],
    [(await event("future", false, new Date("2027-01-01"))).id],
  );
  await talk(
    [liveSpeaker.id],
    [(await event("live", false, new Date(now.getTime() + 1))).id],
  );
  await talk([orphan.id], []);
  const result = await getSpeakerDirectory(db, now);
  expect(result.speakers.map((s) => s.profile.name)).toEqual([
    "Member",
    "Organizer",
  ]);
  expect(result.talks).toHaveLength(1);
  expect(result.talks[0].speakerIds).toEqual([member.id, organizer.id]);
  expect(result.talks[0].eventSlug).toBe("public");
});

test("retains repeat appearances and co-speakers without duplicate profile talk IDs or hidden links", async () => {
  const a = await profile("A");
  const b = await profile("B");
  const first = await event("first");
  const second = await event("second", false, now);
  const hidden = await event("hidden", true);
  const shared = await talk([a.id, b.id], [first.id, second.id, hidden.id]);
  await talk([a.id], [hidden.id]);
  const result = await getSpeakerDirectory(db, now);
  expect(result.speakers).toHaveLength(2);
  expect(result.speakers.map((s) => s.talkIds)).toEqual([
    [shared.id],
    [shared.id],
  ]);
  expect(result.talks.map((t) => t.eventSlug).sort()).toEqual([
    "first",
    "second",
  ]);
  expect(
    result.talks.every((t) => t.speakerIds.join() === [a.id, b.id].join()),
  ).toBe(true);
});

test("returns an empty directory when there are no public past talks", async () => {
  expect(await getSpeakerDirectory(db, now)).toEqual({
    speakers: [],
    talks: [],
  });
});
