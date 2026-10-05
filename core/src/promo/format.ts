import {
  type Moment,
  moments,
  type PromoDrafts,
  type SocialChannel,
  socialChannels,
} from "./drafts.ts";
import { lengthOn, limits } from "./limits.ts";

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
