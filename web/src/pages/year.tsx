import type { PortraitsById } from "allthings-core/src/portraits.ts";
import type { YearEvening, YearView } from "allthings-core/src/year.ts";
import { DateTime } from "effect";
import { eventPath, personPath, yearPath } from "../links.ts";
import { yearCard } from "../og/year-card.ts";
import { count } from "./about.tsx";
import { Document } from "./document.tsx";
import { EveningName } from "./evening-row.tsx";
import { Tally } from "./figures.tsx";
import { hostNames } from "./home.tsx";
import { gatheringTitle } from "./metadata.tsx";
import { type ImageMode, Photo, screenShare, showable } from "./picture.tsx";
import type { Theme } from "./theme.ts";
import { simpleDate } from "./time.ts";

/**
 * /year/<yyyy>: a year of our evenings, looked back on (core's
 * src/year.ts). Its hero is the lab's year-end retro: photos of the year's
 * evenings hanging at different depths around one statement made of its
 * numbers, in the visitor's mode like every page. Under it, the year's
 * tally, then every evening held in it in the order they were held: when
 * and where, its name, who hosted, who was on stage and how many said
 * "I'm in". An evening without a photo is shown without one; the row
 * closes up around its words. Then the other years. Every number is
 * counted from the data.
 *
 * The evenings index links each year that held one of ours here
 * (pages/events.tsx); the sitemap lists every year.
 */

/** The field's photos: twelve places around the statement. */
export const fieldCount = 12;

/**
 * The statement, from the tally: how many people said "I'm in", and over
 * how many evenings, in `year` when it is a year's. Without guests
 * counted, the evenings alone.
 */
export function statement(
  tally: { readonly guests: number; readonly evenings: number },
  year?: number,
): { readonly lead: string; readonly after: string } {
  const evenings = `${count(tally.evenings)} ${tally.evenings === 1 ? "evening" : "evenings"}`;
  const place = "the neighborhoods of San Francisco";
  if (tally.guests > 0) {
    return {
      lead: `${count(tally.guests)} people said “I’m in.”`,
      after:
        year === undefined
          ? `${evenings}, in ${place}.`
          : `${evenings} in ${year}, in ${place}.`,
    };
  }
  return {
    lead: `${evenings} for people who build software.`,
    after: year === undefined ? `In ${place}.` : `In ${place}, in ${year}.`,
  };
}

export interface YearProps {
  readonly year: YearView;
  /** The production origin, which the page's canonical URL is made from. */
  readonly origin: string;
  readonly theme: Theme | undefined;
  /** The hosts' portraits, for the footer. */
  readonly portraits: PortraitsById;
  /** How photos are shown (see picture.tsx). */
  readonly images: ImageMode;
}

/** "2026 in evenings": the page's name. */
export const yearTitle = (year: number): string => `${year} in evenings`;

/** "A", "A and B", "A, B and C", each a link to their page. */
function People({ people }: { readonly people: YearEvening["onStage"] }) {
  return (
    <>
      {people.map((person, index) => (
        <>
          {index === 0 ? "" : index === people.length - 1 ? " and " : ", "}
          <a href={personPath(person.slug)} safe>
            {person.name}
          </a>
        </>
      ))}
    </>
  );
}

/** One evening of the year: its words, and its photo when it has one. */
function EveningEntry({
  entry,
  images,
}: {
  readonly entry: YearEvening;
  readonly images: ImageMode;
}) {
  const { evening, onStage, guests } = entry;
  const [photo] = entry.photo === null ? [] : showable([entry.photo], images);
  return (
    <li
      class={photo === undefined ? "year-evening" : "year-evening with-photo"}
    >
      <div class="year-evening-text">
        <p class="at-type-meta">
          <time datetime={DateTime.formatIso(evening.startsAt)} safe>
            {simpleDate(evening.startsAt)}
          </time>
          {evening.neighborhood === null ? (
            ""
          ) : (
            <span safe>{` · ${evening.neighborhood}`}</span>
          )}
        </p>
        <h3 class="year-evening-name">
          <a href={eventPath(evening.slug)}>
            <EveningName evening={evening} />
          </a>
        </h3>
        {evening.hosts.length === 0 ? (
          ""
        ) : (
          <p class="year-evening-hosts" safe>
            {`Hosted by ${hostNames(evening.hosts)}`}
          </p>
        )}
        {onStage.length === 0 ? (
          ""
        ) : (
          <p class="year-evening-stage">
            On stage: <People people={onStage} />
          </p>
        )}
        {guests === null ? (
          ""
        ) : (
          <p class="at-type-meta" safe>
            {`${count(guests)} said “I’m in”`}
          </p>
        )}
      </div>
      {photo === undefined ? (
        ""
      ) : (
        <div class="year-evening-photo">
          <Photo
            photo={photo}
            mode={images}
            sizes={screenShare(40, 100)}
            widest={960}
          />
        </div>
      )}
    </li>
  );
}

/** The year page for `year`, in the visitor's mode. */
export function yearPage({
  year: view,
  origin,
  theme,
  portraits,
  images,
}: YearProps): string {
  const { year, tally, evenings, years } = view;
  const field = evenings
    .flatMap(({ photo }) => (photo === null ? [] : showable([photo], images)))
    .slice(0, fieldCount);
  const { lead, after } = statement(tally, year);
  const others = years.filter((other) => other !== year);
  const title = yearTitle(year);
  return Document({
    section: "events",
    depth: true,
    meta: {
      title: gatheringTitle(title),
      description: `${lead} ${after}`,
      path: yearPath(year),
      image: yearCard(view),
    },
    origin,
    theme,
    portraits,
    images,
    children: (
      <div class="year">
        <section class="depth year-hero" aria-labelledby="year-statement">
          <div class="depth-field" aria-hidden="true">
            <div class="depth-sway">
              {field.map((photo) => (
                <div class="depth-photo">
                  <div class="depth-drift">
                    <Photo
                      photo={{ ...photo, alt: "" }}
                      mode={images}
                      sizes={screenShare(22, 26)}
                      widest={720}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div class="depth-text">
            <p class="at-type-meta" safe>
              {title}
            </p>
            <h1 id="year-statement" class="depth-statement">
              <span safe>{lead}</span>
              <span class="depth-after" safe>
                {after}
              </span>
            </h1>
          </div>
        </section>
        <Tally tally={tally} kind="band" label={`In ${year}`} />
        <section class="list year-evenings" aria-labelledby="year-evenings">
          <div class="list-head">
            <h2 id="year-evenings" class="list-title at-type-meta" safe>
              {`Every evening of ${year}`}
            </h2>
          </div>
          <ol>
            {evenings.map((entry) => (
              <EveningEntry entry={entry} images={images} />
            ))}
          </ol>
        </section>
        {others.length === 0 ? (
          ""
        ) : (
          <nav class="year-others at-type-meta" aria-label="Other years">
            <ul class="socials">
              {others.map((other) => (
                <li>
                  <a href={yearPath(other)} safe>
                    {yearTitle(other)}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </div>
    ),
  });
}
