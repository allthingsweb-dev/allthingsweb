import { afterAll, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { DateTime, Effect, Layer } from "effect";
import {
  DataSourceError,
  EventNotFound,
  RedirectNotFound,
} from "../src/errors.ts";
import { Events } from "../src/events.ts";
import { Redirects } from "../src/redirects.ts";
import type * as Rows from "../src/rows.ts";
import { Speakers } from "../src/speakers.ts";
import { clockAt, now, seededDatabase, sqlLayer } from "./support/database.ts";

/**
 * The repositories against the migrated production schema and tests/seed.sql,
 * read at 2026-10-03T19:00:00Z.
 */

const db = await seededDatabase();
afterAll(() => db.close());

const repositories = Layer.mergeAll(
  Events.layer,
  Speakers.layer,
  Redirects.layer,
);
const run = <A, E>(
  effect: Effect.Effect<A, E, Events | Speakers | Redirects>,
  options: { readonly database?: PGlite; readonly at?: DateTime.Utc } = {},
) =>
  Effect.runPromise(
    Effect.provide(
      effect,
      repositories.pipe(
        Layer.provideMerge(sqlLayer(options.database ?? db)),
        Layer.provideMerge(clockAt(options.at ?? now)),
      ),
    ),
  );

const at = (iso: string) => DateTime.makeUnsafe(iso);

const image = (
  url: string,
  alt: string,
  width: number,
  height: number,
  placeholder: string,
): Rows.Image => ({
  url: `https://storage.example/${url}`,
  alt,
  width,
  height,
  placeholder,
});

const cover = image(
  "covers/react.png",
  "React at Acme",
  1200,
  630,
  "data:image/png;base64,AA",
);
const acmeLogo = image(
  "logos/acme.png",
  "Acme",
  512,
  512,
  "data:image/png;base64,AB",
);
const crowd = image(
  "photos/crowd.jpg",
  "The crowd",
  1600,
  1067,
  "data:image/png;base64,AC",
);
const stage = image(
  "photos/stage.jpg",
  "The stage",
  1600,
  900,
  "data:image/png;base64,AD",
);
const adaPhoto = image(
  "people/ada.jpg",
  "Ada Lovelace",
  400,
  400,
  "data:image/png;base64,AE",
);

const ada: Rows.Profile = {
  id: "b0000000-0000-4000-8000-000000000001",
  name: "Ada Lovelace",
  title: "Engineer",
  bio: "Writes compilers.",
  twitterHandle: "ada",
  blueskyHandle: "ada.bsky.social",
  linkedinHandle: "ada-lovelace",
  image: adaPhoto,
};
const grace: Rows.Profile = {
  id: "b0000000-0000-4000-8000-000000000002",
  name: "Grace Hopper",
  title: "Admiral",
  bio: "",
  twitterHandle: null,
  blueskyHandle: null,
  linkedinHandle: "grace hopper",
  image: null,
};
const linus: Rows.Profile = {
  id: "b0000000-0000-4000-8000-000000000003",
  name: "Linus",
  title: "",
  bio: "Kernel.",
  twitterHandle: "@linus",
  blueskyHandle: null,
  linkedinHandle: null,
  image: null,
};
const zed: Rows.Profile = {
  id: "b0000000-0000-4000-8000-000000000006",
  name: "Zed Nobody",
  title: "",
  bio: "",
  twitterHandle: null,
  blueskyHandle: null,
  linkedinHandle: null,
  image: null,
};

/** A profile as a talk's speaker, presenting unless said otherwise. */
const speaking = (
  profile: Rows.Profile,
  role: Rows.SpeakerRole = "speaker",
): Rows.TalkSpeaker => ({ ...profile, role });

const serverComponents: Rows.Talk = {
  id: "a0000000-0000-4000-8000-000000000001",
  title: "Server components",
  description:
    "<p>Why <strong>RSC</strong> &amp; streaming matter.</p><ul><li>One</li><li>Two</li></ul>",
  format: "talk",
  speakers: [speaking(grace), speaking(ada)],
};

describe("Events", () => {
  test("lists published events only, latest start first", async () => {
    const published = await run(Events.use((events) => events.listPublished));
    expect(published.map((event) => event.slug)).toEqual([
      "2026-11-05-upcoming",
      "2026-10-03-hack-day",
      "2026-10-03-ends-now",
      "2026-08-12-react-at-acme",
      "2025-12-02-café-night",
    ]);
  });

  test("reads an event's columns and preview image", async () => {
    const published = await run(Events.use((events) => events.listPublished));
    expect(
      published.find((event) => event.slug === "2026-08-12-react-at-acme"),
    ).toEqual({
      id: "e0000000-0000-4000-8000-000000000001",
      slug: "2026-08-12-react-at-acme",
      name: "React at Acme",
      tagline: "Server components in practice",
      startDate: at("2026-08-13T01:00:00Z"),
      endDate: at("2026-08-13T04:00:00Z"),
      streetAddress: "1 Market St",
      shortLocation: "Acme HQ",
      fullAddress: "1 Market St, San Francisco, CA 94105",
      lumaEventId: "evt-react",
      recordingUrl: "https://www.youtube.com/watch?v=abc123",
      isHackathon: false,
      previewImage: cover,
    });
    expect(
      published.find((event) => event.slug === "2026-10-03-hack-day"),
    ).toMatchObject({
      shortLocation: null,
      fullAddress: null,
      lumaEventId: null,
      isHackathon: true,
      previewImage: null,
    });
  });

  test("gets an event with talks, speakers, hosts and photos in attach order", async () => {
    const event = await run(
      Events.use((events) => events.getPublished("2026-08-12-react-at-acme")),
    );
    expect(event.talks).toEqual([
      {
        id: "a0000000-0000-4000-8000-000000000002",
        title: "Effect in production",
        description:
          '<p>Typed errors<br>and services.</p><script>alert(1)</script><img src="x" onerror="alert(1)">',
        format: "talk",
        speakers: [speaking(linus)],
      },
      serverComponents,
    ]);
    expect(event.hosts).toEqual([
      {
        id: "c0000000-0000-4000-8000-000000000002",
        name: "Globex",
        about: "Drinks.",
        squareLogoLight: null,
        squareLogoDark: null,
      },
      {
        id: "c0000000-0000-4000-8000-000000000001",
        name: "Acme",
        about: "Space and pizza.",
        squareLogoLight: acmeLogo,
        squareLogoDark: null,
      },
    ]);
    expect(event.images).toEqual([stage, crowd]);
    expect(event.previewImage).toEqual(cover);
    expect(event.people).toEqual([]);
    expect(event.lumaGuestCount).toBe(118);
    expect(event.lumaCheckedInCount).toBe(97);
  });

  test("gets an event's people by role, then position, and who moderated a fireside", async () => {
    const database = await seededDatabase();
    try {
      await database.exec(`
        UPDATE events SET luma_guest_count = 183, luma_checked_in_count = 141
          WHERE id = 'e0000000-0000-4000-8000-000000000001';
        UPDATE talks SET format = 'fireside'
          WHERE id = 'a0000000-0000-4000-8000-000000000001';
        UPDATE talk_speakers SET role = 'moderator'
          WHERE talk_id = 'a0000000-0000-4000-8000-000000000001'
            AND speaker_id = 'b0000000-0000-4000-8000-000000000002';
        -- Attached out of order: the role, then the position, decide.
        INSERT INTO event_people (event_id, profile_id, role, position, source, created_at, updated_at) VALUES
          ('e0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000006', 'mc', 0, 'site', '2026-01-05T00:00:01Z', now()),
          ('e0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000003', 'co-host', 1, 'luma', '2026-01-05T00:00:02Z', now()),
          ('e0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'co-host', 0, 'luma', '2026-01-05T00:00:03Z', now()),
          ('e0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002', 'organizer', 0, 'luma', '2026-01-05T00:00:04Z', now()),
          ('e0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002', 'mc', 1, 'site', '2026-01-05T00:00:05Z', now());
      `);
      const event = await run(
        Events.use((events) => events.getPublished("2026-08-12-react-at-acme")),
        { database },
      );
      expect(event.people).toEqual([
        { role: "organizer", profile: grace },
        { role: "co-host", profile: ada },
        { role: "co-host", profile: linus },
        { role: "mc", profile: zed },
        { role: "mc", profile: grace },
      ]);
      expect(event.talks[1]).toEqual({
        ...serverComponents,
        format: "fireside",
        speakers: [speaking(grace, "moderator"), speaking(ada)],
      });
      expect(event.lumaGuestCount).toBe(183);
      expect(event.lumaCheckedInCount).toBe(141);
    } finally {
      await database.close();
    }
  });

  test("gets an event without talks, hosts or photos as empty lists", async () => {
    const event = await run(
      Events.use((events) => events.getPublished("2026-11-05-upcoming")),
    );
    expect(event.talks.map((talk) => talk.title)).toEqual(["Next month"]);
    expect(event.hosts).toEqual([]);
    expect(event.images).toEqual([]);
    expect(event.people).toEqual([]);
    expect(event.lumaGuestCount).toBeNull();
    expect(event.lumaCheckedInCount).toBeNull();
  });

  test("a talk given at two events appears at both", async () => {
    const event = await run(
      Events.use((events) => events.getPublished("2025-12-02-café-night")),
    );
    expect(event.talks.map((talk) => talk.title)).toEqual([
      "Coffee & code",
      "Server components",
    ]);
    expect(event.talks[1]).toEqual(serverComponents);
  });

  test.each([
    "2026-09-01-draft-night",
    "no-such-event",
    "2026-08-12-REACT-AT-ACME",
  ])("%s is not found", async (slug) => {
    const error = await run(
      Effect.flip(Events.use((events) => events.getPublished(slug))),
    );
    expect(error).toEqual(new EventNotFound({ slug }));
  });
});

describe("Speakers", () => {
  test("lists speakers of ended, published events by name, with each appearance", async () => {
    const directory = await run(Speakers.use((speakers) => speakers.directory));
    expect(directory.speakers).toEqual([
      { profile: ada, talkIds: ["a0000000-0000-4000-8000-000000000001"] },
      { profile: grace, talkIds: ["a0000000-0000-4000-8000-000000000001"] },
      {
        profile: linus,
        talkIds: [
          "a0000000-0000-4000-8000-000000000002",
          "a0000000-0000-4000-8000-000000000007",
        ],
      },
      { profile: zed, talkIds: ["a0000000-0000-4000-8000-000000000006"] },
    ]);
    expect(
      directory.talks.map((talk) => [
        talk.eventSlug,
        talk.title,
        talk.speakerIds,
      ]),
    ).toEqual([
      ["2026-10-03-ends-now", "Lightning talk", [zed.id]],
      ["2026-08-12-react-at-acme", "Server components", [ada.id, grace.id]],
      ["2026-08-12-react-at-acme", "Effect in production", [linus.id]],
      ["2025-12-02-café-night", "Server components", [ada.id, grace.id]],
      ["2025-12-02-café-night", "Coffee & code", [linus.id]],
    ]);
    expect(directory.talks[0]).toEqual({
      talkId: "a0000000-0000-4000-8000-000000000006",
      title: "Lightning talk",
      description: "Plain text, no markup.",
      speakerIds: [zed.id],
      eventId: "e0000000-0000-4000-8000-000000000005",
      eventName: "Ends now",
      eventSlug: "2026-10-03-ends-now",
      eventStart: at("2026-10-03T15:00:00Z"),
    });
  });

  test("reads the directory as of the clock", async () => {
    const names = async (iso: string) =>
      (
        await run(
          Speakers.use((speakers) => speakers.directory),
          { at: at(iso) },
        )
      ).speakers.map((speaker) => speaker.profile.name);
    // A millisecond before "Ends now" ends, Zed has not spoken yet.
    expect(await names("2026-10-03T18:59:59.999Z")).toEqual([
      "Ada Lovelace",
      "Grace Hopper",
      "Linus",
    ]);
    // Once everything is over, only the draft's speaker and the unattached
    // profile are left out.
    expect(await names("2027-01-01T00:00:00Z")).toEqual([
      "Ada Lovelace",
      "Future Speaker",
      "Grace Hopper",
      "Linus",
      "Zed Nobody",
    ]);
  });
});

describe("Redirects", () => {
  test("looks up a slug exactly", async () => {
    expect(
      await run(Redirects.use((redirects) => redirects.lookup("discord"))),
    ).toEqual({
      slug: "discord",
      destinationUrl: "https://discord.gg/B3Sm4b5mfD",
    });
    expect(
      await run(Redirects.use((redirects) => redirects.lookup("Luma"))),
    ).toEqual({
      slug: "Luma",
      destinationUrl: "https://luma.com/allthingsweb",
    });
  });

  test.each(["Discord", "luma", "missing"])("%s is not found", async (slug) => {
    const error = await run(
      Effect.flip(Redirects.use((redirects) => redirects.lookup(slug))),
    );
    expect(error).toEqual(new RedirectNotFound({ slug }));
  });
});

describe("a failing database", () => {
  test("surfaces as DataSourceError from every repository", async () => {
    const empty = await PGlite.create();
    try {
      const errors = await run(
        Effect.all([
          Effect.flip(Events.use((events) => events.listPublished)),
          Effect.flip(Events.use((events) => events.getPublished("any"))),
          Effect.flip(Speakers.use((speakers) => speakers.directory)),
          Effect.flip(Redirects.use((redirects) => redirects.lookup("any"))),
        ]),
        { database: empty },
      );
      for (const error of errors) expect(error).toBeInstanceOf(DataSourceError);
    } finally {
      await empty.close();
    }
  });
});
