import { eventUrl } from "allthings-core/src/mappers.ts";
import {
  type PeopleView,
  type Person,
  shortBio,
} from "allthings-core/src/people.ts";
import type { PortraitsById } from "allthings-core/src/portraits.ts";
import { DateTime } from "effect";
import { built } from "../assets.ts";
import { Document } from "./document.tsx";
import { EveningName } from "./evening-row.tsx";
import type { Theme } from "./theme.ts";
import { listDate } from "./time.ts";

/**
 * /people: the organizers first, as the foundations ask ("People and
 * channels"), then everyone who has been or will be on stage. Each person
 * is shown only as their profile has them: portrait (the blank avatar
 * without one), name, title, bio and links, then their talks, each linking
 * to its evening. What a profile leaves empty is left out.
 */

export interface PeopleProps {
  readonly people: PeopleView;
  /** Event pages are on the site at this origin. */
  readonly origin: string;
  readonly theme: Theme | undefined;
  /** The hosts' portraits, for the footer. */
  readonly portraits: PortraitsById;
}

/** A person's links in the order shown, each named as the footer names it. */
const linkOrder = ["x", "bluesky", "linkedin"] as const satisfies ReadonlyArray<
  keyof Person["links"]
>;

/**
 * Their photo, or the blank avatar. The name is right beside it, so it
 * says nothing more to a screen reader.
 */
function Portrait({
  person,
  lazy,
}: {
  readonly person: Person;
  readonly lazy: boolean;
}) {
  const { src, width, height } =
    person.photo === null
      ? built.marks.avatar
      : {
          src: person.photo.url,
          width: person.photo.width,
          height: person.photo.height,
        };
  return (
    <img
      class="portrait"
      src={src}
      alt=""
      width={String(width)}
      height={String(height)}
      loading={lazy ? "lazy" : undefined}
      decoding="async"
    />
  );
}

function Links({ person }: { readonly person: Person }) {
  const links = linkOrder.flatMap((name) => {
    const href = person.links[name];
    return href === null ? [] : [{ href, name }];
  });
  if (links.length === 0) return "";
  return (
    <ul class="person-links at-type-meta">
      {links.map(({ href, name }) => (
        <li>
          <a href={href}>{name}</a>
        </li>
      ))}
    </ul>
  );
}

function Talks({
  person,
  origin,
}: {
  readonly person: Person;
  readonly origin: string;
}) {
  if (person.talks.length === 0) return "";
  return (
    <ul class="talks">
      {person.talks.map(({ title, evening }) => (
        <li>
          <a class="talk" href={eventUrl(origin, evening.slug)}>
            <time
              class="date at-type-meta"
              datetime={DateTime.formatIso(evening.startsAt)}
              safe
            >
              {listDate(evening.startsAt)}
            </time>
            <span class="talk-title" safe>
              {title}
            </span>
            <span class="talk-evening">
              <EveningName evening={evening} />
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

/**
 * One person. The organizers are shown whole, above the fold; speakers
 * with a short bio (see shortBio) and portraits that load as they are
 * scrolled to, so the page stays within its budget as the list grows.
 */
function PersonEntry({
  person,
  origin,
  organizer,
}: {
  readonly person: Person;
  readonly origin: string;
  readonly organizer: boolean;
}) {
  return (
    <li class="person">
      <Portrait person={person} lazy={!organizer} />
      <div class="person-text">
        <h3 class="person-name" safe>
          {person.name}
        </h3>
        {person.title === null ? (
          ""
        ) : (
          <p class="person-title at-type-meta" safe>
            {person.title}
          </p>
        )}
        {person.bio === null ? (
          ""
        ) : (
          <p class="person-bio" safe>
            {organizer ? person.bio : shortBio(person.bio)}
          </p>
        )}
        <Links person={person} />
        <Talks person={person} origin={origin} />
      </div>
    </li>
  );
}

/** The whole people page for `people`, in the visitor's mode. */
export function peoplePage({
  people,
  origin,
  theme,
  portraits,
}: PeopleProps): string {
  const { organizers, speakers } = people;
  return Document({
    title: "people · all things/_",
    description:
      "The organizers of all things, and everyone who has been on stage at its evenings in San Francisco.",
    theme,
    portraits,
    children: (
      <div class="people">
        <h1 class="lockup at-type-event-lockup">people</h1>
        {organizers.length === 0 ? (
          ""
        ) : (
          <section class="people-group organizers" aria-labelledby="organizers">
            <h2 id="organizers" class="list-title at-type-meta">
              Organizers
            </h2>
            <ul>
              {organizers.map((person) => (
                <PersonEntry person={person} origin={origin} organizer />
              ))}
            </ul>
          </section>
        )}
        {speakers.length === 0 ? (
          ""
        ) : (
          <section class="people-group speakers" aria-labelledby="speakers">
            <h2 id="speakers" class="list-title at-type-meta">
              Speakers
            </h2>
            <ul>
              {speakers.map((person) => (
                <PersonEntry
                  person={person}
                  origin={origin}
                  organizer={false}
                />
              ))}
            </ul>
          </section>
        )}
      </div>
    ),
  });
}
