import {
  type Moment,
  moments,
  type PromoDrafts,
  type SocialChannel,
  socialChannels,
} from "./drafts.ts";
import {
  type LaunchChannel,
  launchChannels,
  type LaunchDrafts,
  type MeetupAnnouncement,
} from "./launch.ts";
import { lengthOn, limits, type Platform } from "./limits.ts";

/** Where a draft goes: Luma, Meetup, or one of the social channels. */
export type Channel = "luma" | "meetup" | SocialChannel;

export const channels: ReadonlyArray<Channel> = [
  "luma",
  "meetup",
  ...socialChannels,
];

const isSocial = (channel: Channel): channel is SocialChannel =>
  channel !== "luma" && channel !== "meetup";

const momentNames: Readonly<Record<Moment, string>> = {
  announce: "announce",
  dayOf: "day-of",
  recap: "recap",
};

/** Why an evening we only share has no Luma or Meetup draft of ours. */
const notOurs =
  "None: this evening is shared, not ours. Its organizer's page is theirs to write.";

/** "(212 / 280)": a draft's length as its platform counts it, and the limit. */
const measure = (channel: Channel, text: string) =>
  `(${lengthOn(channel, text)} / ${limits[channel]})`;

/** The drafts for `selected` channels as text to read and copy from. */
export function formatDrafts(
  drafts: PromoDrafts,
  selected: ReadonlyArray<Channel> = channels,
): string {
  const sections = selected.map((channel) => {
    if (channel === "luma") {
      return drafts.luma === null
        ? `## luma\n\n${notOurs}`
        : `## luma: description ${measure("luma", drafts.luma)}\n\n${drafts.luma}`;
    }
    if (channel === "meetup") {
      const { meetup } = drafts;
      if (meetup === null) return `## meetup\n\n${notOurs}`;
      return [
        "## meetup",
        `title: ${meetup.title}`,
        `venue: ${meetup.venue ?? "(none on record)"}`,
        `event chat: ${meetup.eventChat}`,
        `topics: ${meetup.topics.join(", ")}`,
        `settings to set by hand:\n${meetup.checklist.map((item) => `- [ ] ${item}`).join("\n")}`,
        `description ${measure("meetup", meetup.description)}:\n\n${meetup.description}`,
      ].join("\n\n");
    }
    return moments
      .map(
        (moment) =>
          `## ${channel}: ${momentNames[moment]} ${measure(channel, drafts.social[channel][moment])}\n\n${drafts.social[channel][moment]}`,
      )
      .join("\n\n");
  });
  const gaps =
    drafts.gaps.length === 0
      ? []
      : [
          `## gaps in the record\n\n${drafts.gaps.map((gap) => `- ${gap}`).join("\n")}`,
        ];
  return [`# ${drafts.title}`, ...gaps, ...sections].join("\n\n") + "\n";
}

/** A draft with its length as its platform counts it, and the limit. */
const measured = (channel: Channel, text: string) => ({
  text,
  length: lengthOn(channel, text),
  limit: limits[channel],
});

/** The drafts for `selected` channels as JSON, each with its length. */
export function draftsJson(
  drafts: PromoDrafts,
  selected: ReadonlyArray<Channel> = channels,
) {
  return {
    title: drafts.title,
    gaps: drafts.gaps,
    ...(selected.includes("luma")
      ? {
          luma: drafts.luma === null ? null : measured("luma", drafts.luma),
        }
      : {}),
    ...(selected.includes("meetup")
      ? {
          meetup:
            drafts.meetup === null
              ? null
              : {
                  ...drafts.meetup,
                  description: measured("meetup", drafts.meetup.description),
                },
        }
      : {}),
    social: Object.fromEntries(
      selected
        .filter(isSocial)
        .map((channel) => [
          channel,
          Object.fromEntries(
            moments.map((moment) => [
              moment,
              measured(channel, drafts.social[channel][moment]),
            ]),
          ),
        ]),
    ),
  };
}

/** "(212 / 280)" on a platform, or "(212 characters)" where none limits it. */
const measureLaunch = (platform: Platform | null, text: string) =>
  platform === null
    ? `(${text.length} characters)`
    : `(${lengthOn(platform, text)} / ${limits[platform]})`;

/** The launch kit's drafts for `selected` channels as text to read and copy from. */
export function formatLaunch(
  drafts: LaunchDrafts,
  selected: ReadonlyArray<LaunchChannel> = launchChannels,
): string {
  const single = (channel: "bluesky" | "linkedin" | "discord") =>
    `## ${channel} ${measureLaunch(channel, drafts[channel])}\n\n${drafts[channel]}`;
  const section: Readonly<Record<LaunchChannel, () => string>> = {
    x: () =>
      drafts.x
        .map(
          (post, index) =>
            `## x: thread ${index + 1}/${drafts.x.length} ${measureLaunch("x", post)}\n\n${post}`,
        )
        .join("\n\n"),
    bluesky: () => single("bluesky"),
    linkedin: () => single("linkedin"),
    discord: () => single("discord"),
    luma: () =>
      `## luma: newsletter ${measureLaunch("luma", drafts.luma.body)}\n\nsubject: ${drafts.luma.subject}\n\n${drafts.luma.body}`,
    meetup: () =>
      drafts.meetup
        .map(
          ({ group, subject, body }) =>
            `## meetup: ${group.name} ${measureLaunch("meetup", body)}\n\ngroup: ${group.url}\n\nsubject: ${subject}\n\n${body}`,
        )
        .join("\n\n"),
    about: () =>
      `## about: history ${measureLaunch(null, drafts.about)}\n\n${drafts.about}`,
  };
  const sections = selected.map((channel) => section[channel]());
  const list = (title: string, items: ReadonlyArray<string>, mark: string) =>
    items.length === 0
      ? []
      : [`## ${title}\n\n${items.map((item) => `${mark}${item}`).join("\n")}`];
  return (
    [
      "# launch: allthings",
      ...list("gaps", drafts.gaps, "- "),
      ...list("before posting", drafts.checklist, "- [ ] "),
      ...sections,
    ].join("\n\n") + "\n"
  );
}

/** A launch draft with its length, and its platform's limit where one has one. */
const measuredLaunch = (
  platform: Platform | null,
  text: string,
): MeasuredLaunch => ({
  text,
  length: platform === null ? text.length : lengthOn(platform, text),
  limit: platform === null ? null : limits[platform],
});

/** A launch draft as JSON: its text, its length, and its platform's limit or null. */
export interface MeasuredLaunch {
  readonly text: string;
  readonly length: number;
  readonly limit: number | null;
}

/** The launch kit as JSON: each selected channel's drafts, measured. */
export interface LaunchJson {
  readonly gaps: ReadonlyArray<string>;
  readonly checklist: ReadonlyArray<string>;
  readonly x?: ReadonlyArray<MeasuredLaunch>;
  readonly bluesky?: MeasuredLaunch;
  readonly linkedin?: MeasuredLaunch;
  readonly discord?: MeasuredLaunch;
  readonly luma?: { readonly subject: string; readonly body: MeasuredLaunch };
  readonly meetup?: ReadonlyArray<
    Omit<MeetupAnnouncement, "body"> & { readonly body: MeasuredLaunch }
  >;
  readonly about?: MeasuredLaunch;
}

/** The launch kit's drafts for `selected` channels as JSON, each with its length. */
export function launchJson(
  drafts: LaunchDrafts,
  selected: ReadonlyArray<LaunchChannel> = launchChannels,
): LaunchJson {
  const has = (channel: LaunchChannel) => selected.includes(channel);
  return {
    gaps: drafts.gaps,
    checklist: drafts.checklist,
    ...(has("x")
      ? { x: drafts.x.map((post) => measuredLaunch("x", post)) }
      : {}),
    ...(has("bluesky")
      ? { bluesky: measuredLaunch("bluesky", drafts.bluesky) }
      : {}),
    ...(has("linkedin")
      ? { linkedin: measuredLaunch("linkedin", drafts.linkedin) }
      : {}),
    ...(has("discord")
      ? { discord: measuredLaunch("discord", drafts.discord) }
      : {}),
    ...(has("luma")
      ? {
          luma: {
            subject: drafts.luma.subject,
            body: measuredLaunch("luma", drafts.luma.body),
          },
        }
      : {}),
    ...(has("meetup")
      ? {
          meetup: drafts.meetup.map(({ body, ...announcement }) => ({
            ...announcement,
            body: measuredLaunch("meetup", body),
          })),
        }
      : {}),
    ...(has("about") ? { about: measuredLaunch(null, drafts.about) } : {}),
  };
}
