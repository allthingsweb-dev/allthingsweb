import type {
  ExternalTalk,
  ExternalTalkKind,
} from "allthings-core/src/external-talks.ts";
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
import { ogCards } from "../og/cards.ts";

/**
 * /people/<slug>: one person, as their profile has them, beside what they
 * did at our evenings and the ones we shared: their talks and their parts,
 * latest first, and, for an organizer, every evening they hosted. Laid out
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

/** "07.30.24" for "2024-07-30": the day as every list writes dates. */
const listDay = (givenOn: string): string => {
  const [year = "", month = "", day = ""] = givenOn.split("-");
  return `${month}.${day}.${year.slice(2)}`;
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
              {listDay(talk.givenOn)}
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

/** "3 talks" and "1 talk", for the page's description. */
const count = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/** What the page says it is: their title, then their part at all things. */
function description(person: PersonPage): string {
  const talks = (curation: "ours" | "shared") =>
    person.parts.filter(
      (part) => part.kind === "talk" && part.evening.curation === curation,
    ).length;
  const ours = talks("ours");
  const shared = talks("shared");
  const done = [
    ...(person.hosted.length === 0
      ? []
      : [count(person.hosted.length, "evening hosted", "evenings hosted")]),
    ...(ours === 0 ? [] : [count(ours, "talk", "talks")]),
  ];
  const lead =
    person.title === null ? person.name : `${person.name}, ${person.title}`;
  const at = [
    ...(done.length === 0 ? [] : [` ${done.join(" and ")} at all things.`]),
    ...(shared === 0
      ? []
      : [` ${count(shared, "talk", "talks")} at evenings all things shared.`]),
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
}: PersonProps): string {
  const path = personPath(person.slug);
  // One row per evening: the hosted ones under Hosted, then our others,
  // then the ones we only shared, never one as another.
  const { ours, shared, hosted } = personRows(person);
  return Document({
    section: "people",
    meta: {
      title: gatheringTitle(person.name),
      description: description(person),
      path,
      image: ogCards.people,
      structuredData: [personStructuredData(person, `${origin}${path}`)],
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
          {ours.length === 0 ? (
            ""
          ) : (
            <Section id="at-all-things" title="At all things">
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
          {person.hosted.length === 0 ? (
            ""
          ) : (
            <Section
              id="hosted"
              title={`Hosted · ${count(person.hosted.length, "evening", "evenings")}`}
            >
              <Appearances rows={hosted} />
            </Section>
          )}
        </div>
      </div>
    ),
  });
}
