import type { PortraitsById } from "allthings-core/src/portraits.ts";
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

/**
 * /talks: every talk given at our evenings, latest evening first and each
 * evening's talks in its running order (core's src/talks-library.ts),
 * under the year it was given in, as /events lists the evenings. Each
 * talk is a row as a person's page lists one: the day, the title, then
 * who gave it, each linking to their page, and the evening, linking to
 * its page; under it, the evening's recording, when it has one. Nothing a
 * talk leaves out is filled in.
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

/**
 * One talk: its evening's day, its title, who gave it and where, and the
 * evening's recording under the row.
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
        <span class="talk-title" safe>
          {talk.title}
        </span>
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
      {talk.recordingUrl === null ? (
        ""
      ) : (
        <a class="talk-video at-type-meta" href={talk.recordingUrl}>
          <span>recording</span>
          <span class="visually-hidden" safe>
            {` of the evening with ${talk.title}`}
          </span>
        </a>
      )}
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
