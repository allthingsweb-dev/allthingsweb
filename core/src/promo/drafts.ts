import { DateTime } from "effect";
import type { EventPage, Person, Speaker, Talk } from "../event-page.ts";
import { eventUrl, httpUrlOrNull } from "../mappers.ts";
import type { StageRole } from "../people.ts";
import { htmlToPlainText } from "../rich-text.ts";
import { fitOn, type Platform } from "./limits.ts";

/**
 * Drafts for promoting an evening, made from its record alone: the Luma
 * description, the Meetup cross-post with its manual settings, and posts
 * for X, Bluesky, LinkedIn and Discord when it is announced, on the day,
 * and after. Drafts only: nothing here posts anything.
 *
 * In the brand's diction (brand/foundations.md, "Voice"): evenings, not
 * events; "I'm in", never RSVP or sign up; hosted at, never sponsored; the
 * neighborhood by its local name; no hype words, exclamation marks or
 * emoji in our own words. "see you at/<topic>" follows a commitment, so it
 * closes only the day-of message to the Discord, never a post that asks.
 */

/** Where people talk between evenings. */
export const discordInvite = "https://discord.gg/B3Sm4b5mfD";

/** Every evening, on Luma: the group our copy names. */
export const lumaCalendar = "https://luma.com/allthingsweb";

/** A profile's handles as stored, for tagging. */
export interface Handles {
  readonly x: string | null;
  readonly bluesky: string | null;
  readonly linkedin: string | null;
}

/** What the drafts are made from. */
/** A hosting company's own site and handles, as stored. */
export interface HostLinks extends Handles {
  readonly website: string | null;
}

export interface PromoInput {
  readonly event: EventPage;
  /** Each person's stored handles, by profile id. */
  readonly handles: ReadonlyMap<string, Handles>;
  /** Each hosting company's site and handles, by its name. */
  readonly hosts: ReadonlyMap<string, HostLinks>;
  /** The site's origin, for the evening's page and the people page. */
  readonly origin: string;
}

export type Moment = "announce" | "dayOf" | "recap";

export const moments: ReadonlyArray<Moment> = ["announce", "dayOf", "recap"];

export type SocialChannel = "x" | "bluesky" | "linkedin" | "discord";

export const socialChannels: ReadonlyArray<SocialChannel> = [
  "x",
  "bluesky",
  "linkedin",
  "discord",
];

export interface MeetupDraft {
  readonly title: string;
  /** Markdown, for the event's description. */
  readonly description: string;
  /** Pick this named place in Meetup's location search; null when none is on record. */
  readonly venue: string | null;
  readonly eventChat: string;
  /** Five topics: broad enough to reach, one of them plain AI. */
  readonly topics: ReadonlyArray<string>;
  /** Settings Meetup has no API for, to set by hand. */
  readonly checklist: ReadonlyArray<string>;
}

export interface PromoDrafts {
  readonly title: string;
  /** What the record lacks that the drafts would say: fix these first. */
  readonly gaps: ReadonlyArray<string>;
  /** Markdown, for Luma's description. */
  readonly luma: string;
  readonly meetup: MeetupDraft;
  readonly social: Readonly<
    Record<SocialChannel, Readonly<Record<Moment, string>>>
  >;
}

const sanFrancisco = DateTime.zoneMakeNamedUnsafe("America/Los_Angeles");
const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const months = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const local = (instant: DateTime.Utc) =>
  DateTime.toParts(DateTime.setZone(instant, sanFrancisco));

/** "Wed Sep 30" in San Francisco. */
export function dayOf(instant: DateTime.Utc): string {
  const { weekDay, month, day } = local(instant);
  return `${weekdays[weekDay] ?? ""} ${months[month - 1] ?? ""} ${day}`;
}

/** "5:30 PM" in San Francisco. */
export function clockOf(instant: DateTime.Utc): string {
  const { hour, minute } = local(instant);
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
}

/** "all things/effect", or the name as written when it has no topic. */
export const titleOf = (event: EventPage): string =>
  event.topic === undefined ? event.name : `all things/${event.topic}`;

/** A stored X handle as X spells it, or null when it isn't one. */
export function xHandle(stored: string | null): string | null {
  const handle = stored?.trim().replace(/^@/, "") ?? "";
  return /^[A-Za-z0-9_]{1,15}$/.test(handle) ? handle : null;
}

/** A stored Bluesky handle, or null when it isn't a domain-like one. */
export function blueskyHandle(stored: string | null): string | null {
  const handle = stored?.trim().replace(/^@/, "").toLowerCase() ?? "";
  return /^([a-z0-9-]+\.)+[a-z]{2,}$/.test(handle) ? handle : null;
}

/** "A", "A and B", "A, B and C". */
export function listOf(items: ReadonlyArray<string>): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1) ?? ""}`;
}

/** Everyone a talk puts on stage, moderators apart. */
const onStage = (talk: Talk) => ({
  speakers: talk.speakers.filter((s) => s.role !== "moderator"),
  moderators: talk.speakers.filter((s) => s.role === "moderator"),
});

/** How a name reads in a post on `channel`: tagged where a handle is stored. */
function nameOn(
  channel: SocialChannel,
  person: Pick<Person, "id" | "name">,
  handles: ReadonlyMap<string, Handles>,
): string {
  const stored = handles.get(person.id);
  if (channel === "x") {
    const handle = xHandle(stored?.x ?? null);
    return handle === null ? person.name : `@${handle}`;
  }
  if (channel === "bluesky") {
    const handle = blueskyHandle(stored?.bluesky ?? null);
    return handle === null ? person.name : `@${handle}`;
  }
  return person.name;
}

/** How a hosting company reads in a post on `channel`: tagged where a handle is stored. */
function hostOn(
  channel: SocialChannel,
  name: string,
  hosts: ReadonlyMap<string, HostLinks>,
): string {
  const stored = hosts.get(name);
  const handle =
    channel === "x"
      ? xHandle(stored?.x ?? null)
      : channel === "bluesky"
        ? blueskyHandle(stored?.bluesky ?? null)
        : null;
  return handle === null ? name : `@${handle}`;
}

const formatNames = {
  talk: "a talk",
  panel: "a panel",
  fireside: "a fireside chat",
};

/**
 * Who is on stage, in one phrase: "a fireside chat with A, moderated by
 * B", "talks by A, B and C". Null without talks.
 */
function stagePhrase(
  talks: ReadonlyArray<Talk>,
  name: (person: Speaker) => string,
): string | null {
  if (talks.length === 0) return null;
  const [only] = talks;
  if (talks.length === 1 && only !== undefined) {
    const { speakers, moderators } = onStage(only);
    const by = speakers.length === 0 ? "" : listOf(speakers.map(name));
    const lead =
      only.format === "talk"
        ? `a talk${by === "" ? "" : ` by ${by}`}`
        : `${formatNames[only.format]}${by === "" ? "" : ` with ${by}`}`;
    return moderators.length === 0
      ? lead
      : `${lead}, moderated by ${listOf(moderators.map(name))}`;
  }
  const people = [
    ...new Map(
      talks
        .flatMap((talk) => onStage(talk).speakers)
        .map((speaker) => [speaker.id, speaker] as const),
    ).values(),
  ];
  return people.length === 0
    ? `${talks.length} talks`
    : `talks by ${listOf(people.map(name))}`;
}

/**
 * Where, said before the evening: "hosted at CodeRabbit in East Cut", or
 * the place alone when no company hosts it.
 */
function wherePhrase(
  event: EventPage,
  hostName: (name: string) => string = (name) => name,
): string | null {
  const place = placePhrase(event, hostName);
  return event.hosts.length > 0 && place !== null
    ? `hosted at ${place}`
    : place;
}

/** A name that only says the venue isn't known yet: "TBA", "TBD". */
const unknownVenue = /^(tba|tbd|to be (announced|determined))\.?$/i;

/** The venue's name, unless it is a stand-in for one. */
const venueName = (event: EventPage): string | null => {
  const name = event.venue?.name ?? null;
  return name === null || unknownVenue.test(name.trim()) ? null : name;
};

/** Whether the record says anything about where: a host, a venue's name, an address or a neighborhood. */
const knowsWhere = (event: EventPage): boolean =>
  event.hosts.length > 0 ||
  venueName(event) !== null ||
  (event.venue?.address ?? null) !== null ||
  (event.venue?.neighborhood ?? null) !== null;

/** Where, in one phrase: "CodeRabbit in East Cut". */
function placePhrase(
  event: EventPage,
  hostName: (name: string) => string = (name) => name,
): string | null {
  const host =
    event.hosts.length > 0
      ? listOf(event.hosts.map(hostName))
      : venueName(event);
  const neighborhood = event.venue?.neighborhood ?? null;
  if (host !== null && neighborhood !== null)
    return `${host} in ${neighborhood}`;
  return host ?? neighborhood;
}

/** The text a tagline adds, unless it is Luma's placeholder. */
const taglineOf = (event: EventPage): string | null => {
  const tagline = event.tagline.trim();
  // Luma's placeholder, the old name (history only), or the evening's
  // name again: none of them says anything the draft doesn't.
  return tagline === "" ||
    tagline.startsWith("See Luma for event details") ||
    /all things web/i.test(tagline) ||
    tagline.toLowerCase().includes(event.name.toLowerCase())
    ? null
    : tagline;
};

/** Paragraphs, each said once, blank-line separated; empty ones dropped. */
const paragraphs = (...parts: ReadonlyArray<string | null | undefined>) =>
  parts
    .filter(
      (part): part is string =>
        part !== null && part !== undefined && part !== "",
    )
    .join("\n\n");

/**
 * "see you at/effect": only where the reader has already said they're in.
 * An event without a topic is signed off with its name.
 */
export const signOff = (event: EventPage): string =>
  `see you ${event.topic === undefined ? event.name : `at/${event.topic}`}`;

/** "Tonight" for an evening, "Today" for a daytime event. */
const todayWord = (event: EventPage) =>
  event.mode === "night" ? "Tonight" : "Today";

/**
 * Who posted about the evening on `channel`'s own platform, as it tags
 * them, each once. Discord and LinkedIn tag no one by text.
 */
function postersOn(
  channel: SocialChannel,
  event: EventPage,
): ReadonlyArray<string> {
  const handleOf =
    channel === "x" ? xHandle : channel === "bluesky" ? blueskyHandle : null;
  if (handleOf === null) return [];
  const handles = event.posts
    .filter((post) => post.platform === channel)
    .map((post) => handleOf(post.authorHandle));
  return [
    ...new Set(handles.filter((handle): handle is string => handle !== null)),
  ].map((handle) => `@${handle}`);
}

/** "12 photos and 9 posts from the evening: ", or "" with neither. */
function afterwards(event: EventPage): string {
  const posts = event.posts.length + event.morePosts;
  const counts = [
    event.photos.length === 0 ? null : plural(event.photos.length, "photo"),
    posts === 0 ? null : plural(posts, "post"),
  ].filter((count): count is string => count !== null);
  return counts.length === 0 ? "" : `${listOf(counts)} from the evening: `;
}

const plural = (count: number, noun: string) =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;

/** Posts for `channel` at each moment, each the richest that fits. */
function socialDrafts(
  channel: SocialChannel,
  input: PromoInput,
): Readonly<Record<Moment, string>> {
  const { event, handles, origin } = input;
  const title = titleOf(event);
  const platform: Platform = channel;
  const name = (person: Pick<Person, "id" | "name">) =>
    nameOn(channel, person, handles);
  const stage = stagePhrase(event.talks, name);
  const stageNames = stagePhrase(event.talks, (person) => person.name);
  const hostName = (host: string) => hostOn(channel, host, input.hosts);
  const place = placePhrase(event, hostName);
  const where = wherePhrase(event, hostName);
  const when = `${dayOf(event.startsAt)}, ${clockOf(event.startsAt)}`;
  const luma = event.rsvpUrl;
  const page = eventUrl(origin, event.slug);
  const discordStyle = channel === "discord";
  const heading = discordStyle ? `**${title}**` : title;
  const talkLines = event.talks.map((talk) => {
    const { speakers, moderators } = onStage(talk);
    const who = [
      ...speakers.map((s) => s.name),
      ...moderators.map((m) => `${m.name} (moderator)`),
    ];
    return `- ${talk.title}${who.length === 0 ? "" : `: ${listOf(who)}`}`;
  });
  const longForm = channel === "linkedin" || channel === "discord";

  const announce = fitOn(platform, [
    paragraphs(
      stage === null ? heading : `${heading}: ${stage}.`,
      longForm ? taglineOf(event) : null,
      longForm && talkLines.length > 1 ? talkLines.join("\n") : null,
      `${when}${where === null ? "" : `, ${where}`}.`,
      luma,
    ),
    paragraphs(
      stage === null ? heading : `${heading}: ${stage}.`,
      `${when}${where === null ? "" : `, ${where}`}.`,
      luma,
    ),
    paragraphs(
      stageNames === null ? heading : `${heading}: ${stageNames}.`,
      `${when}.`,
      luma,
    ),
    paragraphs(`${heading}, ${when}.`, luma),
  ]);

  const doors = `Doors ${clockOf(event.startsAt)}${where === null ? "" : `, ${where}`}.`;
  const dayOfDraft = discordStyle
    ? fitOn(platform, [
        paragraphs(
          `**${todayWord(event)}: ${title}**`,
          `If you're in: ${doors.charAt(0).toLowerCase()}${doors.slice(1)}`,
          stage === null ? null : `On stage: ${stage}.`,
          signOff(event),
        ),
        paragraphs(
          `**${todayWord(event)}: ${title}**`,
          `If you're in: ${doors.charAt(0).toLowerCase()}${doors.slice(1)}`,
          signOff(event),
        ),
      ])
    : fitOn(platform, [
        paragraphs(
          `${todayWord(event)}: ${title}.`,
          stage === null ? null : `On stage: ${stage}.`,
          doors,
          luma,
        ),
        paragraphs(`${todayWord(event)}: ${title}.`, doors, luma),
        paragraphs(`${todayWord(event)}: ${title}.`, luma),
      ]);

  // Who posted about it, tagged where the platform is the same.
  const posters = postersOn(channel, event);
  const thanks = (count: number) =>
    count === 0
      ? null
      : `Thanks for posting about it, ${listOf(posters.slice(0, count))}.`;
  const came = event.guests === null ? "" : `, all ${event.guests} of you`;
  const recapLink = `${afterwards(event)}${page}`;
  const thankYou = `Thank you for coming to ${title}${place === null ? "" : ` at ${place}`}${came}.`;
  const onStageLine = stage === null ? null : `On stage: ${stage}.`;
  // Richest first: everyone who posted, then fewer of them, then the
  // stage without them, then the least.
  const recap = fitOn(platform, [
    ...posters.map((_, index) =>
      paragraphs(
        thankYou,
        onStageLine,
        thanks(posters.length - index),
        recapLink,
      ),
    ),
    ...posters.map((_, index) =>
      paragraphs(thankYou, thanks(posters.length - index), recapLink),
    ),
    paragraphs(thankYou, onStageLine, recapLink),
    paragraphs(
      `Thank you for coming to ${title}${came}.`,
      onStageLine,
      recapLink,
    ),
    paragraphs(`Thank you for coming to ${title}.`, recapLink),
    paragraphs(`Thank you for coming to ${title}.`, page),
  ]);

  return { announce, dayOf: dayOfDraft, recap };
}

/** " · panel" after a talk's title, unless the title already says so. */
const formatSuffix = (talk: Talk): string => {
  const format = formatNames[talk.format].replace(/^a /, "");
  return talk.format === "talk" ||
    talk.title.toLowerCase().includes(format.split(" ")[0] ?? format)
    ? ""
    : ` · ${format}`;
};

/**
 * A URL as a Markdown link destination: the characters that would end or
 * break it, percent-encoded, which leaves the address the same.
 */
export const mdUrl = (url: string) =>
  url.replace(
    /[()<> \t\n\r]/g,
    (char) =>
      `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`,
  );

/** Markdown's own characters in a name or title, escaped. */
const md = (text: string) => text.replace(/([\\`*_[\]<>#])/g, "\\$1");

/** Every line its own paragraph: Meetup's editor wants a blank line between each. */
const blankLined = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .join("\n\n");

/** A hosting company's name, bold, and linked to its own site where one is stored. */
function linkedHost(
  name: string,
  hosts: ReadonlyMap<string, HostLinks>,
): string {
  const site = httpUrlOrNull(hosts.get(name)?.website ?? null);
  return site === null
    ? `**${md(name)}**`
    : `**[${md(name)}](${mdUrl(site)})**`;
}

/** A person's name, bold and linked to where they are: X, Bluesky, LinkedIn or the people page. */
function linkedName(
  person: Pick<Person, "id" | "name">,
  handles: ReadonlyMap<string, Handles>,
  origin: string,
): string {
  const stored = handles.get(person.id);
  const x = xHandle(stored?.x ?? null);
  const bluesky = blueskyHandle(stored?.bluesky ?? null);
  const linkedin = stored?.linkedin?.trim().replace(/^@/, "") ?? "";
  const url =
    x !== null
      ? `https://x.com/${x}`
      : bluesky !== null
        ? `https://bsky.app/profile/${bluesky}`
        : /^[A-Za-z0-9-]{3,100}$/.test(linkedin)
          ? `https://www.linkedin.com/in/${linkedin}`
          : `${origin}/people#p-${person.id}`;
  return `**[${md(person.name)}](${mdUrl(url)})**`;
}

/** The one stage role a description names: the rest go without saying. */
const roleNames: Readonly<Record<StageRole, string | null>> = {
  speaker: null,
  guest: null,
  panelist: null,
  moderator: "moderator",
};

/**
 * The shared body of the Luma and Meetup descriptions, in Markdown. Both
 * pages already show the date, time and address, so the body says neither
 * (say each thing once): who hosts, who is on stage with their bios, who
 * runs the evening, and where to talk after.
 */
function descriptionBody(
  input: PromoInput,
  { abstracts, bios }: { abstracts: boolean; bios: boolean },
): string {
  const { event, handles, origin } = input;
  const person = (p: Pick<Person, "id" | "name">) =>
    linkedName(p, handles, origin);
  const talks = event.talks.map((talk) =>
    paragraphs(
      `**${md(talk.title)}**${formatSuffix(talk)}`,
      !abstracts || talk.description === null
        ? null
        : blankLined(md(htmlToPlainText(talk.description))),
      ...talk.speakers.map((speaker) =>
        paragraphs(
          [person(speaker), speaker.title, roleNames[speaker.role]]
            .filter((part) => part !== null && part !== "")
            .map((part, index) => (index === 0 ? part : md(part ?? "")))
            .join(", "),
          !bios || speaker.bio === null ? null : blankLined(md(speaker.bio)),
        ),
      ),
    ),
  );
  const people = (label: string, list: ReadonlyArray<Person>) =>
    list.length === 0 ? null : `${label}: ${listOf(list.map(person))}.`;
  const neighborhood = event.venue?.neighborhood ?? null;
  const hosted =
    event.hosts.length === 0
      ? null
      : `Hosted at ${listOf(event.hosts.map((host) => linkedHost(host, input.hosts)))}${neighborhood === null ? "" : ` in ${neighborhood}`}.`;
  return paragraphs(
    taglineOf(event) === null ? null : md(taglineOf(event) ?? ""),
    hosted,
    talks.length === 0 ? null : "**On stage**",
    ...talks,
    people(
      event.organizers.length === 1 ? "Your host" : "Your hosts",
      event.organizers,
    ),
    people(event.coHosts.length === 1 ? "Co-host" : "Co-hosts", event.coHosts),
    people("MC", event.mcs),
    `**[all things](${lumaCalendar})**: evenings for people who build software, in the neighborhoods of San Francisco. Talk between evenings → **[discord](${discordInvite})**.`,
  );
}

/**
 * The description bodies, richest first: everything, then without the
 * talks' abstracts, then without bios too. Speakers and their bios are
 * what a description is for, so abstracts go first.
 */
const descriptionBodies = (input: PromoInput): ReadonlyArray<string> => [
  descriptionBody(input, { abstracts: true, bios: true }),
  descriptionBody(input, { abstracts: false, bios: true }),
  descriptionBody(input, { abstracts: false, bios: false }),
];

/** Topics Meetup lists, by an evening's topic; the rest are broad. */
const topicsByKeyword: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(effect|typescript)\b/, "TypeScript"],
  [/\b(react native|expo|mobile)\b/, "Mobile Development"],
  [/\b(react|next\.?js)\b/, "React"],
  [/\b(sync|databases?|postgres|sql)\b/, "Databases"],
];

/** Five Meetup topics: the evening's own first, one plain AI, then broad ones. */
export function meetupTopics(event: EventPage): ReadonlyArray<string> {
  const subject = `${event.topic ?? ""} ${event.name}`.toLowerCase();
  const own = topicsByKeyword
    .filter(([pattern]) => pattern.test(subject))
    .map(([, topic]) => topic);
  return [
    ...new Set([
      ...own,
      "Artificial Intelligence",
      "Software Development",
      "Web Development",
      "JavaScript",
      "Open Source",
    ]),
  ].slice(0, 5);
}

/** The Meetup cross-post: description, venue, topics and the settings to set by hand. */
function meetupDraft(input: PromoInput): MeetupDraft {
  const { event } = input;
  const luma = event.rsvpUrl;
  const notice =
    luma === null
      ? null
      : `**Seats are on Luma: [${luma.replace(/^https:\/\//, "")}](${luma}).** The list here on Meetup is a waitlist only.`;
  const venue =
    event.hosts[0] ?? venueName(event) ?? event.venue?.address ?? null;
  return {
    title: titleOf(event),
    description: fitOn(
      "meetup",
      descriptionBodies(input).map((body) => paragraphs(notice, body)),
    ),
    venue,
    eventChat: discordInvite,
    topics: meetupTopics(event),
    checklist: [
      "Attendee limit: 1 (Meetup's minimum), so everyone else lands on the waitlist and takes their seat on Luma.",
      venue === null
        ? "Location: none on record yet; set the venue before publishing."
        : `Location: pick "${venue}" from Meetup's place search, not a bare street address.`,
      `Event chat: Discord, ${discordInvite}.`,
      "Comments: off.",
      "Co-host: add Andre Landgraf.",
      `Cover: the Luma cover padded to 16:9 on black, so Meetup's crop keeps all of it (bun run promo:cover ${event.slug}).`,
      "Cross-post to Remix Bay Area (meetup.com/remix-bay-area): its Discord chat link comes prefilled, so add no second one, and turn its registration form off, which otherwise blocks publishing.",
      "After publishing: announce it to each group, React San Francisco Bay Area and Remix Bay Area.",
    ],
  };
}

/**
 * What the evening's record lacks that its drafts need: without these, a
 * draft leaves out its link, its place or a tag rather than guess.
 */
export function promoGaps({
  event,
  handles,
  hosts,
}: PromoInput): ReadonlyArray<string> {
  const untagged = [
    ...new Map(
      event.talks
        .flatMap((talk) => talk.speakers)
        .map((speaker) => [speaker.id, speaker] as const),
    ).values(),
  ].filter((speaker) => {
    const stored = handles.get(speaker.id);
    return (
      xHandle(stored?.x ?? null) === null &&
      blueskyHandle(stored?.bluesky ?? null) === null
    );
  });
  return [
    ...(event.rsvpUrl === null
      ? ["No Luma event is linked, so nothing says where to take a seat."]
      : []),
    ...(!knowsWhere(event)
      ? ["No host or venue is on record, so nothing says where."]
      : []),
    ...(event.talks.length === 0
      ? ["No talks are on record, so nothing says who is on stage."]
      : []),
    ...untagged.map(
      (speaker) =>
        `${speaker.name} has no X or Bluesky handle on record, so posts name them untagged.`,
    ),
    ...event.hosts.flatMap((name) => {
      const stored = hosts.get(name);
      return [
        ...(httpUrlOrNull(stored?.website ?? null) === null
          ? [
              `${name} has no website on record, so descriptions name it unlinked.`,
            ]
          : []),
        ...(xHandle(stored?.x ?? null) === null &&
        blueskyHandle(stored?.bluesky ?? null) === null
          ? [
              `${name} has no X or Bluesky handle on record, so posts name it untagged.`,
            ]
          : []),
      ];
    }),
  ];
}

/** Every draft for `input`'s evening. */
export function promoDrafts(input: PromoInput): PromoDrafts {
  return {
    title: titleOf(input.event),
    gaps: promoGaps(input),
    luma: fitOn("luma", descriptionBodies(input)),
    meetup: meetupDraft(input),
    social: {
      x: socialDrafts("x", input),
      bluesky: socialDrafts("bluesky", input),
      linkedin: socialDrafts("linkedin", input),
      discord: socialDrafts("discord", input),
    },
  };
}
