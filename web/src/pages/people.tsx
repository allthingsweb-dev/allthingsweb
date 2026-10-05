import {
  type EveningRole,
  type Part,
  type PeopleView,
  type Person,
  shortBio,
} from "allthings-core/src/people-directory.ts";
import type { StageRole } from "allthings-core/src/people.ts";
import type { PortraitsById } from "allthings-core/src/portraits.ts";
import { DateTime } from "effect";
import { built } from "../assets.ts";
import { eventPath, personAnchor } from "../links.ts";
import { Document } from "./document.tsx";
import { EveningName } from "./evening-row.tsx";
import { gatheringTitle } from "./metadata.tsx";
import { hasSource, type ImageMode, SquarePhoto } from "./picture.tsx";
import type { Theme } from "./theme.ts";
import { listDate } from "./time.ts";

/**
 * /people: the organizers first, as the foundations ask ("People and
 * channels"), then everyone who has been or will be on stage, then
 * everyone who co-hosted or MC'd an evening without a talk. Each person is
 * shown only as their profile has them: portrait (the blank avatar without
 * one), name, title, bio and links, then what they did at which evening,
 * each linking to it. What a profile leaves empty is left out.
 */

export interface PeopleProps {
  readonly people: PeopleView;
  /** The production origin, which the page's canonical URL is made from. */
  readonly origin: string;
  readonly theme: Theme | undefined;
  /** The hosts' portraits, for the footer. */
  readonly portraits: PortraitsById;
  /** How photos are shown (see picture.tsx). */
  readonly images: ImageMode;
}

/** A person's links in the order shown, each named as the footer names it. */
const linkOrder = ["x", "bluesky", "linkedin"] as const satisfies ReadonlyArray<
  keyof Person["links"]
>;

/**
 * How large site.css shows portraits: organizers 160 px square (96 on
 * phones), everyone else 72 (64 on phones), each offered up to 3x.
 */
const portraitSizes = {
  organizer: {
    side: 160,
    sides: [160, 320],
    sizes: "(max-width: 600px) 96px, 160px",
  },
  speaker: {
    side: 72,
    sides: [72, 144, 216],
    sizes: "(max-width: 600px) 64px, 72px",
  },
} as const;

/**
 * Their photo, cropped square, or the blank avatar. The name is right
 * beside it, so it says nothing more to a screen reader. The organizers'
 * load at once; everyone's below them as they come into view.
 */
function Portrait({
  person,
  organizer,
  images,
}: {
  readonly person: Person;
  readonly organizer: boolean;
  readonly images: ImageMode;
}) {
  const eager = organizer ? true : undefined;
  if (person.photo === null || !hasSource(person.photo, images)) {
    const { src, width, height } = built.marks.avatar;
    return (
      <img
        class="portrait"
        src={src}
        alt=""
        width={String(width)}
        height={String(height)}
        loading={eager ? undefined : "lazy"}
        decoding="async"
      />
    );
  }
  return (
    <SquarePhoto
      photo={person.photo}
      mode={images}
      {...portraitSizes[organizer ? "organizer" : "speaker"]}
      alt=""
      class="portrait"
      eager={eager}
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

/**
 * A capacity on stage as a talk's line names it; a talk's speaker is the
 * one capacity left unsaid.
 */
const stageLabel: Readonly<Record<StageRole, string | undefined>> = {
  speaker: undefined,
  panelist: "panelist",
  guest: "guest",
  moderator: "moderator",
};

/** A part in an evening as a whole, as its line names it. */
const eveningRoleLabel: Readonly<Record<EveningRole, string>> = {
  "co-host": "co-host",
  mc: "MC",
};

/**
 * What the person did at each evening, latest first: a talk's title (and
 * their capacity, unless they spoke), or their part in the evening, then
 * the evening, linking to it.
 */
function Parts({ parts }: { readonly parts: ReadonlyArray<Part> }) {
  if (parts.length === 0) return "";
  return (
    <ul class="talks">
      {parts.map((part) => {
        const capacity =
          part.kind === "talk" ? stageLabel[part.role] : undefined;
        return (
          <li>
            <a class="talk" href={eventPath(part.evening.slug)}>
              <time
                class="date at-type-meta"
                datetime={DateTime.formatIso(part.evening.startsAt)}
                safe
              >
                {listDate(part.evening.startsAt)}
              </time>
              <span class="talk-title" safe>
                {part.kind === "talk"
                  ? part.title
                  : eveningRoleLabel[part.role]}
              </span>
              <span class="talk-evening">
                <EveningName evening={part.evening} />
                {capacity === undefined ? (
                  ""
                ) : (
                  <span class="talk-role at-type-meta" safe>
                    {` · ${capacity}`}
                  </span>
                )}
              </span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * One person. The organizers are shown whole, above the fold; everyone
 * else with a short bio (see shortBio) and a portrait that loads as it is
 * scrolled to, so the page stays within its budget as the lists grow.
 */
function PersonEntry({
  person,
  organizer,
  images,
}: {
  readonly person: Person;
  readonly organizer: boolean;
  readonly images: ImageMode;
}) {
  return (
    <li class="person" id={personAnchor(person.id)}>
      <Portrait person={person} organizer={organizer} images={images} />
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
        <Parts parts={person.parts} />
      </div>
    </li>
  );
}

/** One group of people under its heading, or nothing without anyone in it. */
function Group({
  id,
  title,
  people,
  organizers,
  images,
}: {
  readonly id: string;
  readonly title: string;
  readonly people: ReadonlyArray<Person>;
  readonly organizers: boolean;
  readonly images: ImageMode;
}) {
  if (people.length === 0) return "";
  return (
    <section class={`people-group ${id}`} aria-labelledby={id}>
      <h2 id={id} class="list-title at-type-meta" safe>
        {title}
      </h2>
      <ul>
        {people.map((person) => (
          <PersonEntry person={person} organizer={organizers} images={images} />
        ))}
      </ul>
    </section>
  );
}

/** The whole people page for `people`, in the visitor's mode. */
export function peoplePage({
  people,
  origin,
  theme,
  portraits,
  images,
}: PeopleProps): string {
  const { organizers, speakers, coHosts } = people;
  return Document({
    meta: {
      title: gatheringTitle("people"),
      description:
        "The organizers of all things, and everyone who has been on stage at its evenings in San Francisco.",
      path: "/people",
    },
    origin,
    theme,
    portraits,
    images,
    children: (
      <div class="people">
        <h1 class="lockup at-type-event-lockup">people</h1>
        <Group
          id="organizers"
          title="Organizers"
          people={organizers}
          organizers
          images={images}
        />
        <Group
          id="speakers"
          title="Speakers"
          people={speakers}
          organizers={false}
          images={images}
        />
        <Group
          id="co-hosts"
          title="Co-hosts and MCs"
          people={coHosts}
          organizers={false}
          images={images}
        />
      </div>
    ),
  });
}
