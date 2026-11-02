import type {
  ExternalTalk,
  ExternalTalkKind,
} from "allthings-core/src/external-talks.ts";
import type { Now, NowLinkKind } from "allthings-core/src/now.ts";
import { lineParts } from "allthings-core/src/now.ts";
import type { PersonPage } from "allthings-core/src/people-directory.ts";
import { personRows, shortBio } from "allthings-core/src/people-directory.ts";
import type { PortraitsById } from "allthings-core/src/portraits.ts";
import { personPath } from "../links.ts";
import { Document } from "./document.tsx";
import { gatheringTitle } from "./metadata.tsx";
import { Appearances, Links, Portrait } from "./people.tsx";
import type { ImageMode } from "./picture.tsx";
import { personStructuredData } from "./structured-data.ts";
import type { Theme } from "./theme.ts";
import { simpleDate, simpleDayOrMonth, simpleMonth } from "./time.ts";
import { ogCards } from "../og/cards.ts";

/**
 * /people/<slug>: one person, as their profile has them, beside what they
 * did at our evenings and the ones we shared, one row per evening, latest
 * first: hosting it, their talks and their other parts. Laid out
 * as /about is: the person holds still beside their parts. What a profile
 * leaves empty is left out, never filled in.
 */

export interface PersonProps {
  readonly person: PersonPage;
  /** The talks they gave elsewhere, latest first (core/src/external-talks.ts). */
  readonly elsewhere: ReadonlyArray<ExternalTalk>;
  /** The production origin, which the page's canonical URL is made from. */
  readonly origin: string;
  readonly theme: Theme | undefined;
  /** The hosts' portraits, for the footer. */
  readonly portraits: PortraitsById;
  /** How photos are shown (see picture.tsx). */
  readonly images: ImageMode;
  /**
   * Show what they do now (docs/now.md). Off on people's pages until Erik
   * has reviewed the pilot; /lab/now shows it.
   */
  readonly showNow?: boolean;
  /** Ask search engines to stay out, as the lab's pages do. */
  readonly noindex?: true;
}

/** One section of the person's parts under its rule and label. */
function Section({
  id,
  title,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly children: JSX.Element;
}) {
  return (
    <section class="about-part" aria-labelledby={id}>
      <h2 id={id} class="at-type-meta" safe>
        {title}
      </h2>
      {children}
    </section>
  );
}

/** How a talk elsewhere was given, as its line names it. */
const kindNames: Readonly<Record<ExternalTalkKind, string>> = {
  conference: "conference",
  meetup: "meetup",
  podcast: "podcast",
  video: "video",
  workshop: "workshop",
};

/**
 * Talks they gave elsewhere, latest first: the day, the title (linking to
 * the talk, else its recording), and where, as what. A recording besides
 * the talk's page gets its own link.
 */
function Elsewhere({ talks }: { readonly talks: ReadonlyArray<ExternalTalk> }) {
  return (
    <ul class="talks">
      {talks.map((talk) => {
        const href = talk.url ?? talk.videoUrl;
        const inner = (
          <>
            <time class="date at-type-meta" datetime={talk.givenOn} safe>
              {simpleDate(talk.givenOn)}
            </time>
            <span class="talk-title" safe>
              {talk.title}
            </span>
            <span class="talk-evening">
              <span safe>{talk.eventName}</span>
              <span class="talk-role at-type-meta" safe>
                {` · ${kindNames[talk.kind]}`}
              </span>
            </span>
          </>
        );
        return (
          <li>
            {href === null ? (
              <div class="talk">{inner}</div>
            ) : (
              <a class="talk" href={href}>
                {inner}
              </a>
            )}
            {talk.url !== null &&
            talk.videoUrl !== null &&
            talk.videoUrl !== talk.url ? (
              <a class="talk-video at-type-meta" href={talk.videoUrl}>
                <span>recording</span>
                <span class="visually-hidden" safe>
                  {` of ${talk.title}`}
                </span>
              </a>
            ) : (
              ""
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** How a piece of their recent work was made, as its line names it. */
const nowKindNames: Readonly<Record<NowLinkKind, string>> = {
  post: "post",
  article: "article",
  video: "video",
  talk: "talk",
  podcast: "podcast",
};

/** Where a link is, as people say it: x.com, youtube.com, leerob.com. */
const siteOf = (url: string): string =>
  new URL(url).hostname.replace(/^www\./, "");

/**
 * What they do now: the line, every fact in it linking to where it was
 * read, then their recent work as talks elsewhere are listed (date, title,
 * where and what), under "Now · as of" the month it was checked.
 */
function NowSection({ now }: { readonly now: Now }) {
  return (
    <Section id="now" title={`Now · as of ${simpleMonth(now.checkedOn)}`}>
      <>
        <p class="person-page-bio person-now">
          {lineParts(now.line).map((part) =>
            part.source === undefined ? (
              <span safe>{part.text}</span>
            ) : (
              <a href={part.source} safe>
                {part.text}
              </a>
            ),
          )}
        </p>
        {now.links.length === 0 ? (
          ""
        ) : (
          <ul class="talks">
            {now.links.map((link) => (
              <li>
                <a class="talk" href={link.url}>
                  <time class="date at-type-meta" datetime={link.date} safe>
                    {simpleDayOrMonth(link.date)}
                  </time>
                  <span class="talk-title" safe>
                    {link.title}
                  </span>
                  <span class="talk-evening">
                    <span safe>{siteOf(link.url)}</span>
                    <span class="talk-role at-type-meta" safe>
                      {` · ${nowKindNames[link.kind]}`}
                    </span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </>
    </Section>
  );
}

/** "3 talks" and "1 talk", for the page's description. */
const count = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/**
 * What the page says it is: their title, then their part at allthings, as
 * the page counts it: the evenings they had a part in, and their talks.
 */
function description(person: PersonPage, evenings: number): string {
  const talks = (curation: "ours" | "shared") =>
    person.parts.filter(
      (part) => part.kind === "talk" && part.evening.curation === curation,
    ).length;
  const ours = talks("ours");
  const shared = talks("shared");
  const done = [
    ...(evenings === 0 ? [] : [count(evenings, "evening", "evenings")]),
    ...(ours === 0 ? [] : [count(ours, "talk", "talks")]),
  ];
  const lead =
    person.title === null ? person.name : `${person.name}, ${person.title}`;
  const at = [
    ...(done.length === 0 ? [] : [` ${done.join(" and ")} at allthings.`]),
    ...(shared === 0
      ? []
      : [` ${count(shared, "talk", "talks")} at evenings allthings shared.`]),
  ].join("");
  const bio = person.bio === null ? "" : ` ${shortBio(person.bio)}`;
  return `${lead}.${at}${bio}`.trim();
}

/** The whole page for `person`, in the visitor's mode. */
export function personPage({
  person,
  elsewhere,
  origin,
  theme,
  portraits,
  images,
  showNow = false,
  noindex,
}: PersonProps): string {
  const path = personPath(person.slug);
  // One row per evening, hosted or not: ours, then the ones we only shared.
  const { ours, shared } = personRows(person);
  return Document({
    section: "people",
    meta: {
      title: gatheringTitle(person.name),
      description: description(person, ours.length),
      path,
      image: ogCards.people,
      structuredData: [personStructuredData(person, `${origin}${path}`)],
      ...(noindex === true ? { noindex } : {}),
    },
    origin,
    theme,
    portraits,
    images,
    children: (
      <div class="about person-page">
        <div class="about-head person-head">
          <Portrait photo={person.photo} organizer images={images} eager />
          <h1 class="person-page-name" safe>
            {person.name}
          </h1>
          {person.title === null ? (
            ""
          ) : (
            <p class="person-title at-type-meta" safe>
              {person.title}
            </p>
          )}
          <Links person={person} />
        </div>
        <div class="about-parts">
          {person.bio === null ? (
            ""
          ) : (
            <Section id="bio" title="Bio">
              <p class="person-page-bio" safe>
                {person.bio}
              </p>
            </Section>
          )}
          {showNow && person.now !== null ? (
            <NowSection now={person.now} />
          ) : (
            ""
          )}
          {ours.length === 0 ? (
            ""
          ) : (
            <Section
              id="at-allthings"
              title={`At allthings · ${count(ours.length, "evening", "evenings")}`}
            >
              <Appearances rows={ours} />
            </Section>
          )}
          {shared.length === 0 ? (
            ""
          ) : (
            <Section id="shared" title="At evenings we shared">
              <Appearances rows={shared} />
            </Section>
          )}
          {elsewhere.length === 0 ? (
            ""
          ) : (
            <Section
              id="elsewhere"
              title={`Talks elsewhere · ${count(elsewhere.length, "talk", "talks")}`}
            >
              <Elsewhere talks={elsewhere} />
            </Section>
          )}
        </div>
      </div>
    ),
  });
}
