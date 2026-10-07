import { DateTime } from "effect";
import type { EventPage } from "../event-page.ts";
import { hackStarter } from "../formats.ts";
import { eventUrl } from "../mappers.ts";
import {
  clockOf,
  dayOf,
  discordInvite,
  lumaCalendar,
  md,
  titleOf,
  wherePhrase,
  xHandle,
} from "./drafts.ts";
import { fitOn } from "./limits.ts";

/**
 * The rebrand's launch kit: one set of drafts announcing that All Things
 * Web is now all things, for X (a thread), Bluesky, the LinkedIn company
 * page, the Discord, the Luma calendar's newsletter, each Meetup group the
 * evenings are listed in, and a short note for /about's history. Drafts
 * only: nothing here posts anything.
 *
 * It says what changed, each thing once, from the record of what the site
 * does: the name and the domain (brand/foundations.md, "Name";
 * infra/docs/r2-migration.md, the full cutover), short links
 * (src/short-slugs.ts), person pages (web/src/pages/person.tsx), shared
 * evenings (src/rows.ts, `Curation`), the at/hack starter (src/formats.ts,
 * `hackStarter`), and the next evening. In the brand's voice like every
 * other draft, with one exception the brand makes for launch messaging:
 * the old name, said once, as what we were.
 *
 * Two things aren't settled, so each is one value with a placeholder in
 * the drafts and a gap that says so: the X account's handle
 * ({@link launchXHandle}) and the next evening (`--next <slug>` once it
 * is published).
 */

/**
 * The X account the launch is posted from and points to, without the @;
 * null until it's ours. The one place to set it.
 */
export const launchXHandle: string | null = null;

/** The handles in the running, for the gap that asks for one. */
export const xHandleChoices = ["allthings", "allthingsdev"] as const;

/** What we were called, said only as what we were. */
export const formerName = "All Things Web";

/** The domain the site had, which redirects to the new one. */
export const formerDomain = "allthingsweb.dev";

/** A Meetup group the evenings are listed in, which continues under all things. */
export interface MeetupGroup {
  readonly name: string;
  readonly url: string;
}

/**
 * The groups each evening is listed in (drafts.ts, the Meetup checklist),
 * with their addresses as the evenings' old descriptions link them.
 */
export const meetupGroups: ReadonlyArray<MeetupGroup> = [
  {
    name: "React San Francisco Bay Area",
    url: "https://www.meetup.com/reactjs-san-francisco/",
  },
  { name: "Remix Bay Area", url: "https://www.meetup.com/remix-bay-area/" },
];

/** The next evening, as the launch names it. */
export interface NextEvening {
  /** Its lockup: "all things/trivia". */
  readonly title: string;
  /** "Thu Nov 12, 6:00 PM", in San Francisco. */
  readonly when: string;
  /** "hosted at CodeRabbit in East Cut", or null when none is on record. */
  readonly where: string | null;
  /** Its page, at its short link. */
  readonly url: string;
}

/** Why an evening can't be the one the launch names next. */
export type NotNext = "ended" | "shared";

/**
 * `event` as the launch names it next, or why it can't be: one that has
 * ended isn't next, and one we only share isn't ours to announce.
 */
export function nextEveningOf(
  event: EventPage,
  origin: string,
  now: DateTime.Utc,
): NextEvening | NotNext {
  if (event.curation.kind === "shared") return "shared";
  if (DateTime.isLessThanOrEqualTo(event.endsAt, now)) return "ended";
  return {
    title: titleOf(event),
    when: `${dayOf(event.startsAt)}, ${clockOf(event.startsAt)}`,
    where: wherePhrase(event),
    url: eventUrl(origin, event.slug),
  };
}

export interface LaunchConfig {
  /** The site's origin: https://allthings.dev. */
  readonly origin: string;
  /** The X account's handle; null until it's chosen (see {@link launchXHandle}). */
  readonly xHandle: string | null;
  /** The evening to name next; null until it's published. */
  readonly next: NextEvening | null;
}

/** A message with a subject line: the Luma newsletter, a Meetup announcement. */
export interface Announcement {
  readonly subject: string;
  readonly body: string;
}

export interface MeetupAnnouncement extends Announcement {
  readonly group: MeetupGroup;
}

export interface LaunchDrafts {
  /** What isn't settled, so the drafts hold a placeholder: settle these first. */
  readonly gaps: ReadonlyArray<string>;
  /** What has to be true, or be done by hand, before anything is posted. */
  readonly checklist: ReadonlyArray<string>;
  /** The X thread, one post each, in order. */
  readonly x: ReadonlyArray<string>;
  readonly bluesky: string;
  /** For the company page; plain text, as LinkedIn shows it. */
  readonly linkedin: string;
  /** Markdown, for the announcements channel. */
  readonly discord: string;
  /** The Luma calendar's newsletter; its body in Markdown. */
  readonly luma: Announcement;
  /** One for each group; plain text, as Meetup sends it. */
  readonly meetup: ReadonlyArray<MeetupAnnouncement>;
  /** Plain text, to follow the history's paragraph on the names. */
  readonly about: string;
}

/** Where a launch draft goes. */
export type LaunchChannel =
  | "x"
  | "bluesky"
  | "linkedin"
  | "discord"
  | "luma"
  | "meetup"
  | "about";

export const launchChannels: ReadonlyArray<LaunchChannel> = [
  "x",
  "bluesky",
  "linkedin",
  "discord",
  "luma",
  "meetup",
  "about",
];

/** The X handle the drafts print until one is chosen. */
const handlePlaceholder = "[x-handle]";

/** The next evening the drafts print until it is published. */
const nextPlaceholder = (origin: string): NextEvening => ({
  title: "[next evening]",
  when: "[day, time]",
  where: "[hosted at …]",
  url: `${origin}/[next]`,
});

/** A URL without its scheme, as running copy shows it. */
const bare = (url: string) =>
  url.replace(/^https?:\/\//, "").replace(/\/$/, "");

/** Paragraphs, blank-line separated; empty ones dropped. */
const paragraphs = (...parts: ReadonlyArray<string | null>) =>
  parts
    .filter((part): part is string => part !== null && part !== "")
    .join("\n\n");

/** The launch's drafts, from what is settled and placeholders for the rest. */
export function launchDrafts(config: LaunchConfig): LaunchDrafts {
  const site = new URL(config.origin).host;
  const handle =
    config.xHandle === null ? handlePlaceholder : xHandle(config.xHandle);
  if (handle === null) {
    throw new Error(`Not an X handle: ${config.xHandle ?? ""}`);
  }
  const next = config.next ?? nextPlaceholder(config.origin);
  const discord = bare(discordInvite);
  const calendar = bare(lumaCalendar);
  const hack = bare(hackStarter.repository);
  const examples = "all things/effect, all things/expo";
  const shortLink = `${site}/<topic>`;
  const people = `${site}/people`;

  /** "Next: all things/trivia, Thu Nov 12, 6:00 PM, hosted at …." */
  const nextLine = (
    withWhere: boolean,
    text: (part: string) => string = (part) => part,
  ) =>
    `Next: ${text(next.title)}, ${text(next.when)}${
      withWhere && next.where !== null ? `, ${text(next.where)}` : ""
    }.`;

  const gaps = [
    ...(config.xHandle === null
      ? [
          `No X handle yet (${xHandleChoices.map((h) => `@${h}`).join(" or ")}): the drafts say @${handlePlaceholder}. Set launchXHandle in core/src/promo/launch.ts, or pass --x-handle.`,
        ]
      : []),
    ...(config.next === null
      ? [
          "No next evening yet: the drafts hold a placeholder until the trivia night is published. Pass --next <slug> then.",
        ]
      : []),
  ];

  const checklist = [
    `${site} serves the new site and every ${formerDomain} address redirects to it, as every draft says (infra/docs/r2-migration.md, the full cutover). Post nothing before.`,
    `Every published evening has its short link, as the drafts say: bun run slugs --dry-run (in core/) gives none, or run it without --dry-run first.`,
    `Post the X thread from @${handle}, each post a reply to the one before.`,
    "Display names say all things before the posts do: X, Bluesky, the LinkedIn page, the Discord server and the Luma calendar.",
    "Send each Meetup announcement from its own group, to all its members.",
  ];

  const x = [
    `${formerName} is now all things.\n\nThe same evenings for people who build software, in the neighborhoods of San Francisco, under one name: all things/_. Each evening fills the slot after the slash.\n\nThe site is ${site}. ${formerDomain} redirects there.`,
    `Every evening has a short link, its name as an address: all things/effect lives at ${site}/effect.\n\nA link, once given, is that evening's for good, so nothing printed, posted or put in a QR code ever comes to mean another evening.`,
    `Everyone who has been on stage has a page now, at ${people}: their talks and parts at our evenings, latest first, and the talks they gave elsewhere.`,
    "Some evenings aren't ours. When someone else runs one we think is good, we share it: it's listed beside ours, marked shared, with who organizes it.",
    `Hackathons start from at/hack, a template: fork it, build, hand in a public repo. Projects are judged on whether they work before how they look: judges run each one and its tests.\n\n${hack}`,
    fitOn("x", [
      paragraphs(
        nextLine(true),
        next.url,
        `Talk between evenings → ${discord}`,
      ),
      paragraphs(
        nextLine(false),
        next.url,
        `Talk between evenings → ${discord}`,
      ),
      paragraphs(nextLine(false), next.url),
    ]),
  ].map((post) => fitOn("x", [post]));

  const bluesky = fitOn("bluesky", [
    paragraphs(
      `${formerName} is now all things: the same evenings for people who build software in San Francisco, at ${site}. ${formerDomain} redirects there.`,
      `New: a short link for every evening (${shortLink}), a page for everyone who's been on stage, evenings we share, and at/hack for hackathons.`,
      `${nextLine(false)} ${next.url}`,
    ),
    paragraphs(
      `${formerName} is now all things, at ${site}. ${formerDomain} redirects there.`,
      `New: a short link for every evening, a page for everyone who's been on stage, evenings we share, and at/hack.`,
      `${nextLine(false)} ${next.url}`,
    ),
    // However long the next evening's name, the redirect and what's new
    // stay; the next evening is its link alone, at the least.
    paragraphs(
      `${formerName} is now all things, at ${site}. ${formerDomain} redirects there.`,
      "New: short links, person pages, shared evenings and at/hack.",
      `${nextLine(false)} ${next.url}`,
    ),
    paragraphs(
      `${formerName} is now all things, at ${site}. ${formerDomain} redirects there.`,
      "New: short links, person pages, shared evenings and at/hack.",
      `Next: ${next.url}`,
    ),
  ]);

  const changes = [
    `Every evening has a short link, ${shortLink}. A link, once given, is that evening's for good.`,
    `Everyone who has been on stage has a page, at ${people}: their talks and parts at our evenings, and the talks they gave elsewhere.`,
    "Evenings other people run that we think are good are listed beside ours, marked shared, with who organizes them.",
    `Hackathons start from at/hack, a template: fork it, build, hand in a public repo. Projects are judged on whether they work before how they look. ${hack}`,
  ];

  const linkedin = fitOn("linkedin", [
    paragraphs(
      `${formerName} is now all things.`,
      `The evenings stay what they were: for people who build software, in the neighborhoods of San Francisco, about who's on stage and what they built. What changes is the name, all things/_, where each evening fills the slot after the slash: ${examples}.`,
      `The site is now ${site}, and ${formerDomain} redirects there. With it:`,
      changes.map((change) => `- ${change}`).join("\n"),
      `${nextLine(true)} ${next.url}`,
      `Talk between evenings → ${discord}\nOn X: x.com/${handle}`,
    ),
  ]);

  // Markdown: names and placeholders escaped, links bare where they read
  // as text.
  const mdNext = (withWhere: boolean) => nextLine(withWhere, md);
  const mdChanges = [
    `Every evening has a short link, ${md(shortLink)}. Once given, it's that evening's for good.`,
    `Everyone who has been on stage has a page: ${people}.`,
    "Evenings other people run that we think are good are listed beside ours, marked shared.",
    `Hackathons start from **at/hack**, a template: fork it, build, hand in a public repo. <${hackStarter.repository}>`,
  ];

  const discordPost = fitOn("discord", [
    paragraphs(
      `**${formerName} is now all things.**`,
      `Same evenings, same server. The name is all things/\\_, and each evening fills the slot after the slash: ${examples}.`,
      `**What changed**\n- The site is **${site}**; ${formerDomain} redirects there.\n${mdChanges.map((change) => `- ${change}`).join("\n")}`,
      `**${mdNext(true)}** <${next.url}>`,
      `On X: **@${md(handle)}**`,
    ),
  ]);

  const luma: Announcement = {
    subject: "These evenings are now all things",
    body: fitOn("luma", [
      paragraphs(
        `${formerName} is now all things: the same evenings for people who build software, in the neighborhoods of San Francisco, under one name, all things/\\_. Each evening fills the slot after the slash: ${examples}.`,
        "Nothing changes here: you keep following this calendar, and every evening's seats are still taken here.",
        `**What changed**\n\n- The site is **[${site}](${config.origin})**, and ${formerDomain} redirects there.\n${mdChanges.map((change) => `- ${change}`).join("\n")}`,
        `**${mdNext(true)}** [${md(bare(next.url))}](${next.url})`,
        `Talk between evenings → **[discord](${discordInvite})**. On X: **[@${md(handle)}](https://x.com/${handle})**.`,
      ),
    ]),
  };

  const meetup = meetupGroups.map(
    (group): MeetupAnnouncement => ({
      group,
      subject: `${group.name}'s evenings are now all things`,
      body: fitOn("meetup", [
        paragraphs(
          `The evenings ${group.name} lists went by ${formerName}. They're now all things: one name, all things/_, and each evening fills the slot after the slash.`,
          `Nothing changes for you here. This group continues under all things, you stay a member, and each evening is still listed here. Seats are on Luma (${calendar}); the list on Meetup is a waitlist.`,
          `What's new on ${site} (${formerDomain} redirects there): a short link for every evening, ${shortLink}; a page for everyone who has been on stage; evenings others run that we think are good, marked shared; and at/hack, the template hackathons start from.`,
          `${nextLine(true)} ${next.url}`,
          `Talk between evenings → ${discord}`,
        ),
      ]),
    }),
  );

  const about = `With the name, the site moved from ${formerDomain} to ${site}, and the old addresses redirect. Each evening has its short link, ${shortLink}, and keeps it. Everyone who has been on stage has a page. Evenings others run that we think are good are listed beside ours, marked shared. And hackathons start from at/hack.`;

  return {
    gaps,
    checklist,
    x,
    bluesky,
    linkedin,
    discord: discordPost,
    luma,
    meetup,
    about,
  };
}
