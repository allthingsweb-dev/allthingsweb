import type { PortraitsById } from "allthings-core/src/portraits.ts";
import type {
  ArtifactKind,
  TalkArtifact,
} from "allthings-core/src/talk-artifacts.ts";
import type { LibraryTalk } from "allthings-core/src/talks-library.ts";
import { DateTime } from "effect";
import { eventPath, everyTalk, personPath } from "../links.ts";
import { ogCards } from "../og/cards.ts";
import { Document } from "./document.tsx";
import { EveningName } from "./evening-row.tsx";
import { gatheringTitle } from "./metadata.tsx";
import type { ImageMode } from "./picture.tsx";
import type { Theme } from "./theme.ts";
import { simpleDate, year } from "./time.ts";
import { proposePath } from "./propose.tsx";

/**
 * /talks: every talk given at our evenings, latest evening first and each
 * evening's talks in its running order (core's src/talks-library.ts),
 * under the year it was given in, as /events lists the evenings. Each
 * talk is a row as a person's page lists one: the day, the title, linking
 * to the talk's own recording when it has one, then who gave it, each
 * linking to their page, and the evening, linking to its page; under it,
 * its slides, code and other links (core's src/talk-artifacts.ts), and the
 * evening's recording where the talk has none of its own. Nothing a talk
 * leaves out is filled in.
 *
 * It belongs to the evenings in the header, as an evening's page does: a
 * fifth section wouldn't fit the header at 320 pixels. Home's Recently
 * links here beside every evening, and the sitemap lists it.
 */

export interface TalksProps {
  readonly talks: ReadonlyArray<LibraryTalk>;
  /** The production origin, which the page's canonical URL is made from. */
  readonly origin: string;
  readonly theme: Theme | undefined;
  /** The hosts' portraits, for the footer. */
  readonly portraits: PortraitsById;
  /** How photos are shown (see picture.tsx). */
  readonly images: ImageMode;
}

export interface YearOfTalks {
  /** In San Francisco, where the evenings happen. */
  readonly year: number;
  readonly talks: ReadonlyArray<LibraryTalk>;
}

/**
 * `talks`, latest first, grouped by the year their evening was in: the
 * latest year first, and each year's talks in the order given.
 */
export function talksByYear(
  talks: ReadonlyArray<LibraryTalk>,
): ReadonlyArray<YearOfTalks> {
  const years: Array<{ year: number; talks: Array<LibraryTalk> }> = [];
  for (const talk of talks) {
    const when = year(talk.evening.startsAt);
    const last = years.at(-1);
    if (last?.year === when) last.talks.push(talk);
    else years.push({ year: when, talks: [talk] });
  }
  return years;
}

/** "1 talk" and "46 talks". */
const count = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/** How a link a talk left behind is named under its row, by its kind. */
const kindNames: Readonly<Record<ArtifactKind, string>> = {
  recording: "recording",
  slides: "slides",
  repo: "code",
  site: "site",
  other: "link",
};

/**
 * The words a talk's link shows: its label, or its kind, and where the
 * same talk was given when it comes from there ("recording at Chain
 * React 2024").
 */
export const artifactText = (artifact: TalkArtifact): string =>
  artifact.label ??
  (artifact.elsewhere === null
    ? kindNames[artifact.kind]
    : `${kindNames[artifact.kind]} at ${artifact.elsewhere}`);

/**
 * Under a talk's row, what it left behind, in order: its slides, code,
 * site and recordings of it elsewhere; and the evening's recording where
 * the talk has none of its own. Nothing when it has neither.
 */
function TalkLinks({ talk }: { readonly talk: LibraryTalk }) {
  const links = [
    ...(talk.links.recording === null && talk.recordingUrl !== null
      ? [
          <a href={talk.recordingUrl}>
            <span>recording</span>
            <span class="visually-hidden" safe>
              {` of the evening with ${talk.title}`}
            </span>
          </a>,
        ]
      : []),
    ...talk.links.artifacts.map((artifact) => (
      <a href={artifact.url}>
        <span safe>{artifactText(artifact)}</span>
        <span class="visually-hidden" safe>
          {` for ${talk.title}`}
        </span>
      </a>
    )),
  ];
  if (links.length === 0) return "";
  return (
    <p class="talk-links at-type-meta">
      {links.map((link, index) => (
        <>
          {index === 0 ? "" : " · "}
          {link}
        </>
      ))}
    </p>
  );
}

/**
 * One talk: its evening's day, its title, linking to the talk's own
 * recording when it has one, who gave it and where, and what it left
 * behind under the row.
 */
function TalkRow({ talk }: { readonly talk: LibraryTalk }) {
  const { evening } = talk;
  return (
    <li>
      <div class="talk">
        <time
          class="date at-type-meta"
          datetime={DateTime.formatIso(evening.startsAt)}
          safe
        >
          {simpleDate(evening.startsAt)}
        </time>
        {talk.links.recording === null ? (
          <span class="talk-title" safe>
            {talk.title}
          </span>
        ) : (
          <a class="talk-title" href={talk.links.recording.url} safe>
            {talk.title}
          </a>
        )}
        <span class="talk-evening">
          {talk.speakers.map((speaker, index) => (
            <>
              {index === 0 ? "" : ", "}
              <a href={personPath(speaker.slug)} safe>
                {speaker.name}
              </a>
            </>
          ))}
          <span class="talk-role at-type-meta">
            {talk.speakers.length === 0 ? "" : " · "}
            <a href={eventPath(evening.slug)}>
              <EveningName evening={evening} />
            </a>
          </span>
        </span>
      </div>
      <TalkLinks talk={talk} />
    </li>
  );
}

/** The whole talks library for `talks`, in the visitor's mode. */
export function talksPage({
  talks,
  origin,
  theme,
  portraits,
  images,
}: TalksProps): string {
  const evenings = new Set(talks.map((talk) => talk.evening.slug)).size;
  return Document({
    section: "events",
    meta: {
      title: gatheringTitle("every talk"),
      description:
        "Every talk given at an allthings evening, with who gave it and its recording. In the neighborhoods of San Francisco.",
      path: everyTalk,
      image: ogCards.talks,
    },
    origin,
    theme,
    portraits,
    images,
    children: (
      <div class="evenings">
        <div class="evenings-head">
          <h1 class="lockup at-type-event-lockup">every talk</h1>
          {talks.length === 0 ? (
            ""
          ) : (
            <p class="at-type-meta" safe>
              {`${count(talks.length, "talk", "talks")} at ${count(evenings, "evening", "evenings")}`}
            </p>
          )}
          <p class="fact-links">
            <a href={proposePath}>
              propose a talk <span aria-hidden="true">→</span>
            </a>
          </p>
        </div>
        <div class="evenings-lists">
          {talksByYear(talks).map(({ year: when, talks: inYear }) => (
            <section class="list" aria-labelledby={`talks-${when}`}>
              <div class="list-head">
                <h2 id={`talks-${when}`} class="list-title at-type-meta" safe>
                  {String(when)}
                </h2>
              </div>
              <ol class="talks">
                {inYear.map((talk) => (
                  <TalkRow talk={talk} />
                ))}
              </ol>
            </section>
          ))}
        </div>
      </div>
    ),
  });
}
