import { dataTheme } from "allthings-brand/src/css.ts";
import type {
  EventPage,
  Person,
  Speaker,
  Talk,
  Venue,
} from "allthings-core/src/event-page.ts";
import type { Evening } from "allthings-core/src/home.ts";
import { eventUrl } from "allthings-core/src/mappers.ts";
import type { PortraitsById } from "allthings-core/src/portraits.ts";
import type * as Rows from "allthings-core/src/rows.ts";
import { DateTime } from "effect";
import { built } from "../assets.ts";
import { everyEvening, googleMaps, hosts, lumaCalendar } from "../links.ts";
import { calendarPath } from "./calendar.ts";
import { Document } from "./document.tsx";
import { Cursor } from "./evening-row.tsx";
import { hostNames } from "./home.tsx";
import { gatheringTitle, homeTitle, lockup, type Title } from "./metadata.tsx";
import {
  hasSource,
  type ImageMode,
  Photo,
  showable,
  SquarePhoto,
} from "./picture.tsx";
import { eventStructuredData } from "./structured-data.ts";
import type { Theme } from "./theme.ts";
import { day, fullDate, timeRange } from "./time.ts";

/**
 * /<slug>: an evening's page, the Ledger (design round EP1-B). The lockup,
 * then a ruled list that names every fact once, each on its own row under a
 * small label: when, where, who hosts, how to get in (or, once it is over,
 * the recording), who is on stage, the photos, and what comes next. A row
 * whose facts are unknown is left out rather than shown empty.
 *
 * The page is in its event's mode (Night for evenings, Paper for daytime
 * events) unless the visitor fixed one with the mode switch.
 */

export interface EventPageProps {
  readonly event: EventPage;
  /** Other events' pages and "every evening" are on the site at this origin. */
  readonly origin: string;
  /** The mode the visitor fixed, if any. */
  readonly theme: Theme | undefined;
  /** The hosts' portraits, for "your hosts" and the footer. */
  readonly portraits: PortraitsById;
  /** How photos are shown (see picture.tsx). */
  readonly images: ImageMode;
}

/**
 * The page's title: all things/<topic>, or the name as written before the
 * open slot when the name yields no topic.
 */
export function eventTitle(event: Pick<EventPage, "topic" | "name">): Title {
  return event.topic === undefined
    ? gatheringTitle(event.name)
    : lockup(event.topic);
}

/**
 * How large the lockup is set: a short topic at the full 112px, a longer
 * one a step down, a name that isn't a topic two.
 */
export function eventLockupSize(
  event: Pick<EventPage, "topic">,
): "l" | "m" | "s" {
  if (event.topic === undefined) return "s";
  return event.topic.length <= "all things/".length ? "l" : "m";
}

function Lockup({ event }: { readonly event: EventPage }) {
  const cursor = event.status === "past" ? "" : <Cursor />;
  const size = eventLockupSize(event);
  if (event.topic === undefined) {
    return (
      <h1 class={`event-name event-name-${size}`}>
        <span safe>{event.name}</span>
        {cursor}
      </h1>
    );
  }
  return (
    <h1 class={`event-name event-name-${size}`}>
      all things<span class="slash">/</span>
      <wbr />
      <span safe>{event.topic}</span>
      {cursor}
    </h1>
  );
}

/** One row of the ledger: a small label, then what it names. */
function Fact({
  label,
  children,
}: {
  readonly label: string;
  readonly children: JSX.Element;
}) {
  return (
    <div class="fact">
      <dt class="at-type-meta" safe>
        {label}
      </dt>
      <dd>{children}</dd>
    </div>
  );
}

function When({ event }: { readonly event: EventPage }) {
  const range = `${timeRange(event.startsAt, event.endsAt)}, San Francisco time`;
  return (
    <Fact label="When">
      <>
        <p class="fact-head">
          <time datetime={DateTime.formatIso(event.startsAt)} safe>
            {fullDate(event.startsAt)}
          </time>
        </p>
        <p safe>{event.status === "live" ? `${range}. On now.` : range}</p>
        {event.status === "past" && event.guests !== null ? (
          <p safe>{`${event.guests} went.`}</p>
        ) : (
          ""
        )}
        {event.status === "past" ? (
          ""
        ) : (
          <p class="fact-links">
            <a href={calendarPath(event.slug)} download="">
              add to calendar <span aria-hidden="true">→</span>
            </a>
          </p>
        )}
      </>
    </Fact>
  );
}

/**
 * The neighborhood, the venue and its address, linked to the map. The
 * venue's name is left out when it is a host's, which "Hosted at" names.
 */
function Where({
  venue,
  hostingCompanies,
}: {
  readonly venue: Venue;
  readonly hostingCompanies: ReadonlyArray<string>;
}) {
  const isHost = (name: string) =>
    hostingCompanies.some((host) => host.toLowerCase() === name.toLowerCase());
  const name = venue.name !== null && !isHost(venue.name) ? venue.name : null;
  const [head, ...rest] = [
    ...(venue.neighborhood === null ? [] : [venue.neighborhood]),
    ...(name === null ? [] : [name]),
  ];
  return (
    <Fact label="Where">
      <>
        {head === undefined ? (
          ""
        ) : (
          <p
            class={
              venue.neighborhood === null ? "fact-head" : "fact-head place"
            }
            safe
          >
            {head}
          </p>
        )}
        {rest.map((line) => (
          <p class="venue" safe>
            {line}
          </p>
        ))}
        {venue.address === null || venue.mapQuery === null ? (
          ""
        ) : (
          <p>
            <a href={googleMaps(venue.mapQuery)}>
              <span safe>{venue.address}</span>
              <span class="visually-hidden">, on Google Maps</span>
            </a>
          </p>
        )}
      </>
    </Fact>
  );
}

/**
 * The squares site.css shows portraits at: hosts, co-hosts and MCs at 44
 * px; speakers at 168, 72 on phones. Each is offered up to 3x.
 */
const portraitSizes = {
  small: { side: 44, sides: [72, 144], sizes: "44px" },
  speaker: {
    side: 168,
    sides: [72, 144, 168, 216, 336],
    sizes: "(max-width: 760px) 72px, 168px",
  },
} as const;

/** A portrait, cropped square, or the brand's blank avatar for someone without one. */
function Portrait({
  portrait,
  size,
  images,
}: {
  readonly portrait: Rows.Photo | null;
  readonly size: keyof typeof portraitSizes;
  readonly images: ImageMode;
}) {
  const { side } = portraitSizes[size];
  if (portrait === null || !hasSource(portrait, images)) {
    return (
      <img
        src={built.marks.avatar.src}
        alt=""
        width={String(side)}
        height={String(side)}
        loading="lazy"
        decoding="async"
      />
    );
  }
  return (
    <SquarePhoto
      photo={portrait}
      mode={images}
      {...portraitSizes[size]}
      alt=""
    />
  );
}

/**
 * The organizers, beside the hosting company on every event page
 * (brand/foundations.md, "People and channels"): the event's own, else
 * Erik and Andre, who sign off every page.
 */
function YourHosts({
  organizers,
  portraits,
  images,
}: {
  readonly organizers: ReadonlyArray<Person>;
  readonly portraits: PortraitsById;
  readonly images: ImageMode;
}) {
  const people: ReadonlyArray<Pick<Person, "portrait">> =
    organizers.length > 0
      ? organizers
      : hosts.map((host) => ({
          portrait: portraits.get(host.profileId) ?? null,
        }));
  const names =
    organizers.length > 0
      ? hostNames(organizers.map((person) => firstName(person.name)))
      : hostNames(hosts.map((host) => host.name));
  return (
    <div class="your-hosts">
      <span class="host-portraits">
        {people.map((person) => (
          <Portrait portrait={person.portrait} size="small" images={images} />
        ))}
      </span>
      <p>
        <span class="at-type-meta">
          {organizers.length === 1 ? "your host" : "your hosts"}
        </span>
        <span class="host-names" safe>
          {names}
        </span>
      </p>
    </div>
  );
}

/** "Erik" for "Erik Thorelli": hosts go by their first names. */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/** Co-hosts or the MC: each with their portrait, name and what they do. */
function People({
  label,
  people,
  images,
}: {
  readonly label: string;
  readonly people: ReadonlyArray<Person>;
  readonly images: ImageMode;
}) {
  return (
    <div class="event-people">
      <p class="at-type-meta" safe>
        {label}
      </p>
      <ul>
        {people.map((person) => (
          <li class="event-person">
            <Portrait portrait={person.portrait} size="small" images={images} />
            <p>
              <span class="event-person-name" safe>
                {person.name}
              </span>
              {person.title === null ? (
                ""
              ) : (
                <span class="event-person-title" safe>
                  {person.title}
                </span>
              )}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function HostedAt({
  event,
  portraits,
  images,
}: {
  readonly event: EventPage;
  readonly portraits: PortraitsById;
  readonly images: ImageMode;
}) {
  const companies = event.hosts;
  return (
    <Fact label={companies.length === 0 ? "Hosted by" : "Hosted at"}>
      <>
        <div class="hosted">
          {companies.length === 0 ? (
            ""
          ) : (
            <p class="fact-head" safe>
              {hostNames(companies)}
            </p>
          )}
          <YourHosts
            organizers={event.organizers}
            portraits={portraits}
            images={images}
          />
        </div>
        {event.coHosts.length === 0 ? (
          ""
        ) : (
          <People
            label={event.coHosts.length === 1 ? "co-host" : "co-hosts"}
            people={event.coHosts}
            images={images}
          />
        )}
        {event.mcs.length === 0 ? (
          ""
        ) : (
          <People label="mc" people={event.mcs} images={images} />
        )}
      </>
    </Fact>
  );
}

/** How to get in: seats on Luma and "I'm in". */
function Seats({
  rsvpUrl,
  seats,
  guests,
}: {
  readonly rsvpUrl: string;
  readonly seats: number | null;
  readonly guests: number | null;
}) {
  const counts = [
    ...(guests === null ? [] : [`${guests} going`]),
    ...(seats === null ? [] : [`${seats} seats`]),
  ].join(" · ");
  return (
    <Fact label="Seats">
      <div class="act">
        {counts === "" ? "" : <p safe>{counts}</p>}
        <a class="button" href={rsvpUrl}>
          I’m in<span class="visually-hidden">, on Luma</span>
          <span aria-hidden="true">→</span>
        </a>
      </div>
    </Fact>
  );
}

function Recording({ url }: { readonly url: string }) {
  return (
    <Fact label="Recording">
      <div class="act">
        <a class="button" href={url}>
          Watch<span class="visually-hidden"> the recording</span>
          <span aria-hidden="true">→</span>
        </a>
      </div>
    </Fact>
  );
}

/** A profile link's handle, as people write it: "@ada", "ada.bsky.social". */
export function handleOf(url: string): string {
  const { pathname } = new URL(url);
  const segment = pathname.slice(pathname.lastIndexOf("/") + 1);
  let handle = segment;
  try {
    handle = decodeURIComponent(segment);
  } catch {
    // Malformed percent-encoding: the segment as written still names them.
  }
  return handle.replace(/^@/, "");
}

function SpeakerLinks({ speaker }: { readonly speaker: Speaker }) {
  const { x, bluesky, linkedin } = speaker.links;
  const links = [
    ...(x === null ? [] : [{ href: x, text: `@${handleOf(x)}`, on: "X" }]),
    ...(bluesky === null
      ? []
      : [{ href: bluesky, text: `@${handleOf(bluesky)}`, on: "Bluesky" }]),
    ...(linkedin === null
      ? []
      : [{ href: linkedin, text: "linkedin", on: "LinkedIn" }]),
  ];
  if (links.length === 0) return "";
  return (
    <ul class="speaker-links">
      {links.map((link) => (
        <li>
          <a href={link.href}>
            <span safe>{link.text}</span>
            <span class="visually-hidden" safe>
              {`, ${speaker.name} on ${link.on}`}
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

function SpeakerCard({
  speaker,
  images,
}: {
  readonly speaker: Speaker;
  readonly images: ImageMode;
}) {
  return (
    <article class="speaker">
      <Portrait portrait={speaker.portrait} size="speaker" images={images} />
      <div class="speaker-who">
        {speaker.role === "speaker" ? (
          ""
        ) : (
          <p class="speaker-role at-type-meta">{speaker.role}</p>
        )}
        <h3 class="at-type-list-name" safe>
          {speaker.name}
        </h3>
        {speaker.title === null ? (
          ""
        ) : (
          <p class="speaker-title" safe>
            {speaker.title}
          </p>
        )}
        <SpeakerLinks speaker={speaker} />
      </div>
      {speaker.bio === null ? (
        ""
      ) : (
        <p class="speaker-bio" safe>
          {speaker.bio}
        </p>
      )}
    </article>
  );
}

/** How a talk that isn't a plain talk is held, as the page names it. */
const formatNames = {
  panel: "panel",
  fireside: "fireside chat",
} as const;

function TalkEntry({
  talk,
  images,
}: {
  readonly talk: Talk;
  readonly images: ImageMode;
}) {
  // Sanitized by core (rich-text.ts): formatting and safe links only.
  const safeDescription = talk.description;
  return (
    <section class="stage-talk">
      {talk.format === "talk" ? (
        ""
      ) : (
        <p class="at-type-meta">{formatNames[talk.format]}</p>
      )}
      <h2 class="stage-title at-type-lead" safe>
        {talk.title}
      </h2>
      {safeDescription === null ? (
        ""
      ) : (
        <div class="stage-description">{safeDescription}</div>
      )}
      {talk.speakers.length === 0 ? (
        ""
      ) : (
        <div class="speakers">
          {talk.speakers.map((speaker) => (
            <SpeakerCard speaker={speaker} images={images} />
          ))}
        </div>
      )}
    </section>
  );
}

function OnStage({
  talks,
  images,
}: {
  readonly talks: ReadonlyArray<Talk>;
  readonly images: ImageMode;
}) {
  return (
    <Fact label="On stage">
      <div class="stage">
        {talks.map((talk) => (
          <TalkEntry talk={talk} images={images} />
        ))}
      </div>
    </Fact>
  );
}

/**
 * How wide site.css shows a photo: a third of the ledger's 9 of 12 columns
 * (24 px gutters, 10 px gaps) on a page at most 1440 px wide with margins
 * of 4.5vw (16 to 64 px), and half the page width from 760 px down. That
 * is 319 px at 1440 and 166 at 375.
 */
const photoSizes =
  "(max-width: 760px) calc(45.5vw - 5px), (max-width: 1440px) calc(22.75vw - 9px), 320px";

/** Every photo of the evening, loaded as it is scrolled to. */
function Photos({
  photos,
  images,
}: {
  readonly photos: ReadonlyArray<Rows.Photo>;
  readonly images: ImageMode;
}) {
  return (
    <Fact label="Photos">
      <ul class="photos">
        {photos.map((photo) => (
          <li>
            <Photo photo={photo} mode={images} sizes={photoSizes} />
          </li>
        ))}
      </ul>
    </Fact>
  );
}

/** After an evening: the next one, or the open slot and the calendar. */
function Next({
  next,
  origin,
}: {
  readonly next: Evening | undefined;
  readonly origin: string;
}) {
  if (next === undefined) {
    return (
      <Fact label="Next">
        <>
          <p class="next-name">
            all things<span class="slash">/</span>
            <Cursor />
          </p>
          <p class="fact-links">
            <a href={lumaCalendar}>subscribe on luma</a>
            {" · "}
            <a href={everyEvening}>
              every evening <span aria-hidden="true">→</span>
            </a>
          </p>
        </>
      </Fact>
    );
  }
  const where = next.neighborhood === null ? "" : ` · ${next.neighborhood}`;
  return (
    <Fact label="Next">
      <>
        <p class="next-name">
          <a href={eventUrl(origin, next.slug)}>
            {next.topic === undefined ? (
              <span safe>{next.name}</span>
            ) : (
              <>
                at<span class="slash">/</span>
                <span safe>{next.topic}</span>
              </>
            )}
            <Cursor />
          </a>
        </p>
        <p class="at-type-meta">
          <time datetime={DateTime.formatIso(next.startsAt)} safe>
            {`${next.status === "live" ? "Now" : day(next.startsAt)}${where}`}
          </time>
        </p>
      </>
    </Fact>
  );
}

/** Where an event's page is on the site: its slug, encoded, as one segment. */
export const eventPagePath = (slug: string): `/${string}` =>
  `/${encodeURIComponent(slug)}`;

/** The whole page for `event`, in its mode unless the visitor fixed one. */
export function eventPage({
  event,
  origin,
  theme,
  portraits,
  images,
}: EventPageProps): string {
  const past = event.status === "past";
  const photos = showable(event.photos, images);
  const tagline = event.tagline.trim();
  return Document({
    meta: {
      title: eventTitle(event),
      description:
        tagline === ""
          ? "An evening for people who build software, in San Francisco."
          : tagline,
      path: eventPagePath(event.slug),
      structuredData: [eventStructuredData(event, origin)],
    },
    origin,
    theme,
    pageTheme: dataTheme[event.mode],
    portraits,
    images,
    children: (
      <article class="event">
        <Lockup event={event} />
        <dl class="ledger">
          <When event={event} />
          {event.venue === null ? (
            ""
          ) : (
            <Where venue={event.venue} hostingCompanies={event.hosts} />
          )}
          <HostedAt event={event} portraits={portraits} images={images} />
          {!past && event.rsvpUrl !== null ? (
            <Seats
              rsvpUrl={event.rsvpUrl}
              seats={event.seats}
              guests={event.guests}
            />
          ) : (
            ""
          )}
          {past && event.recordingUrl !== null ? (
            <Recording url={event.recordingUrl} />
          ) : (
            ""
          )}
          {event.talks.length === 0 ? (
            ""
          ) : (
            <OnStage talks={event.talks} images={images} />
          )}
          {/* Posts about the evening on socials go here, once the X
              integration lands. */}
          {past && photos.length > 0 ? (
            <Photos photos={photos} images={images} />
          ) : (
            ""
          )}
          {past ? <Next next={event.next} origin={origin} /> : ""}
        </dl>
      </article>
    ),
  });
}

/** What every page that stands in for an event's page is rendered for. */
export interface StandInProps {
  /** The production origin, which the page's canonical URL is made from. */
  readonly origin: string;
  /** The address that was asked for, which stays the canonical one. */
  readonly path: `/${string}`;
  readonly theme: Theme | undefined;
  /** How photos are shown (see picture.tsx). */
  readonly images: ImageMode;
}

/** Nothing published lives at this address: said plainly, with ways on. */
export function notFoundPage({
  origin,
  path,
  theme,
  portraits,
  images,
}: StandInProps & { readonly portraits: PortraitsById }): string {
  return Document({
    meta: {
      title: gatheringTitle("not found"),
      description: "No evening lives at this address.",
      path,
    },
    origin,
    theme,
    portraits,
    images,
    children: (
      <div class="intro">
        <p class="at-type-meta">404 · not found</p>
        <h1 class="lockup at-type-event-lockup">
          all things<span class="slash">/</span>
          <Cursor />
        </h1>
        <p class="lead at-type-lead">No evening lives at this address.</p>
        <p class="fact-links">
          <a href={everyEvening}>
            every evening <span aria-hidden="true">→</span>
          </a>
          {" · "}
          <a href={lumaCalendar}>subscribe on luma</a>
        </p>
      </div>
    ),
  });
}

/**
 * An event's page when its data can't be read: said plainly, never cached.
 * The hosts' portraits weren't read either, so the blank avatar stands in.
 */
export function eventUnavailablePage({
  origin,
  path,
  theme,
  images,
}: StandInProps): string {
  return Document({
    meta: {
      title: homeTitle,
      description: "Evenings for people who build software in San Francisco.",
      path,
    },
    origin,
    theme,
    portraits: new Map(),
    images,
    children: (
      <div class="intro">
        <p class="at-type-meta">temporarily unavailable</p>
        <h1 class="lockup at-type-event-lockup">
          all things<span class="slash">/</span>
          <Cursor />
        </h1>
        <p class="lead at-type-lead">
          This evening didn’t load. Try again in a minute.
        </p>
      </div>
    ),
  });
}
