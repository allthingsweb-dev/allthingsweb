import {
  type Appearance,
  appearances,
  type EveningRole,
  type Part,
  type PeopleView,
  type Person,
  shortBio,
} from "allthings-core/src/people-directory.ts";
import type { StageRole } from "allthings-core/src/people.ts";
import type { PortraitsById } from "allthings-core/src/portraits.ts";
import type * as Rows from "allthings-core/src/rows.ts";
import { DateTime } from "effect";
import { below, portrait } from "allthings-brand/src/layout.ts";
import { built } from "../assets.ts";
import { eventPath, personAnchor, personPath } from "../links.ts";
import { Document } from "./document.tsx";
import { EveningName } from "./evening-row.tsx";
import { gatheringTitle } from "./metadata.tsx";
import { hasSource, type ImageMode, SquarePhoto } from "./picture.tsx";
import type { Theme } from "./theme.ts";
import { ogCards } from "../og/cards.ts";
import { simpleDate } from "./time.ts";

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
 * How large site.css shows portraits, from the layout tokens: organizers
 * extra large (large on phones), everyone else medium, each offered up to
 * 3x.
 */
const portraitSizes = {
  organizer: {
    side: portrait.xl,
    sides: [168, 336],
    sizes: `${below("xl")} ${portrait.l}px, ${portrait.xl}px`,
  },
  speaker: {
    side: portrait.m,
    sides: [72, 144, 216],
    sizes: `${portrait.m}px`,
  },
} as const;

/**
 * Their photo, cropped square, or the blank avatar. The name is right
 * beside it, so it says nothing more to a screen reader. The organizers'
 * load at once; everyone's below them as they come into view.
 */
export function Portrait({
  photo,
  organizer,
  images,
  eager,
}: {
  readonly photo: Rows.Photo | null;
  readonly organizer: boolean;
  readonly images: ImageMode;
  readonly eager: true | undefined;
}) {
  if (photo === null || !hasSource(photo, images)) {
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
      photo={photo}
      mode={images}
      {...portraitSizes[organizer ? "organizer" : "speaker"]}
      alt=""
      class="portrait"
      eager={eager}
    />
  );
}

export function Links({ person }: { readonly person: Pick<Person, "links"> }) {
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
export const eveningRoleLabel: Readonly<Record<EveningRole, string>> = {
  "co-host": "co-host",
  mc: "MC",
};

/** A part as an evening's row names it: "talk: State of Effect 2026", "MC". */
export function partLabel(part: Part): string {
  if (part.kind === "role") return eveningRoleLabel[part.role];
  return `${stageLabel[part.role] ?? "talk"}: ${part.title}`;
}

/**
 * The evenings a person took part in, latest first, one row each: the
 * evening, linking to it, then every part they had in it, in core's
 * order (eveningPartOrder): "talk: State of Effect 2026 · MC".
 */
export function Appearances({
  rows,
}: {
  readonly rows: ReadonlyArray<Appearance>;
}) {
  if (rows.length === 0) return "";
  return (
    <ul class="talks">
      {rows.map(({ evening, parts }) => (
        <li>
          <a class="talk" href={eventPath(evening.slug)}>
            <time
              class="date at-type-meta"
              datetime={DateTime.formatIso(evening.startsAt)}
              safe
            >
              {simpleDate(evening.startsAt)}
            </time>
            <span class="talk-title">
              <EveningName evening={evening} />
            </span>
            {parts.length === 0 ? (
              ""
            ) : (
              <span class="talk-parts" safe>
                {parts.map(partLabel).join(" · ")}
              </span>
            )}
          </a>
        </li>
      ))}
    </ul>
  );
}

/**
 * How many evenings /people lists for a person, newest first, each one row
 * with every part they had in it. The rest are on their own page, which
 * lists every one.
 */
export const recentEvenings = 3;

/**
 * A person's latest evenings, then, when they have more, a link to their
 * page, which has all of them.
 */
export function RecentEvenings({ person }: { readonly person: Person }) {
  const rows = appearances(person.parts);
  const more = rows.length > recentEvenings;
  return (
    <>
      <Appearances rows={rows.slice(0, recentEvenings)} />
      {more ? (
        <p class="list-links">
          <a href={personPath(person.slug)}>
            <span safe>{`all ${rows.length}`}</span>
            <span class="visually-hidden" safe>
              {` of ${person.name}'s evenings`}
            </span>
            {" on their page "}
            <span aria-hidden="true">→</span>
          </a>
        </p>
      ) : (
        ""
      )}
    </>
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
      <Portrait
        photo={person.photo}
        organizer={organizer}
        images={images}
        eager={organizer ? true : undefined}
      />
      <div class="person-text">
        <h3 class="person-name">
          <a href={personPath(person.slug)} safe>
            {person.name}
          </a>
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
        <RecentEvenings person={person} />
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
    section: "people",
    meta: {
      title: gatheringTitle("people"),
      description:
        "The organizers of allthings, and everyone who has been on stage at its evenings in San Francisco.",
      path: "/people",
      image: ogCards.people,
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
