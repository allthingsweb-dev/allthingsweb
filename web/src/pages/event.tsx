import { dataTheme } from "allthings-brand/src/css.ts";
import type {
  EventPage,
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
}

/** all things/<topic> as the page's title, or the name as written. */
export function lockupText(event: Pick<EventPage, "topic" | "name">): string {
  return event.topic === undefined ? event.name : `all things/${event.topic}`;
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

/** Erik and Andre, beside the hosting company on every event page. */
function YourHosts({ portraits }: { readonly portraits: PortraitsById }) {
  return (
    <div class="your-hosts">
      <span class="host-portraits">
        {hosts.map((host) => (
          <img
            src={portraits.get(host.profileId)?.url ?? built.marks.avatar.src}
            alt=""
            width="44"
            height="44"
            loading="lazy"
            decoding="async"
          />
        ))}
      </span>
      <p>
        <span class="at-type-meta">your hosts</span>
        <span class="host-names" safe>
          {`${hosts[0].name} & ${hosts[1].name}`}
        </span>
      </p>
    </div>
  );
}

function HostedAt({
  companies,
  portraits,
}: {
  readonly companies: ReadonlyArray<string>;
  readonly portraits: PortraitsById;
}) {
  return (
    <Fact label={companies.length === 0 ? "Hosted by" : "Hosted at"}>
      <div class="hosted">
        {companies.length === 0 ? (
          ""
        ) : (
          <p class="fact-head" safe>
            {hostNames(companies)}
          </p>
        )}
        <YourHosts portraits={portraits} />
      </div>
    </Fact>
  );
}

/** How to get in: seats on Luma and "I'm in". */
function Seats({
  rsvpUrl,
  seats,
}: {
  readonly rsvpUrl: string;
  readonly seats: number | null;
}) {
  return (
    <Fact label="Seats">
      <div class="act">
        {seats === null ? "" : <p safe>{`${seats}, held on Luma.`}</p>}
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
  const path = decodeURIComponent(new URL(url).pathname);
  return path.slice(path.lastIndexOf("/") + 1).replace(/^@/, "");
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

function SpeakerCard({ speaker }: { readonly speaker: Speaker }) {
  return (
    <article class="speaker">
      <img
        src={speaker.portrait?.url ?? built.marks.avatar.src}
        alt=""
        width="168"
        height="168"
        loading="lazy"
        decoding="async"
      />
      <div class="speaker-who">
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

function TalkEntry({ talk }: { readonly talk: Talk }) {
  // Sanitized by core (rich-text.ts): formatting and safe links only.
  const safeDescription = talk.description;
  return (
    <section class="talk">
      <h2 class="talk-title at-type-lead" safe>
        {talk.title}
      </h2>
      {safeDescription === null ? (
        ""
      ) : (
        <div class="talk-description">{safeDescription}</div>
      )}
      {talk.speakers.length === 0 ? (
        ""
      ) : (
        <div class="speakers">
          {talk.speakers.map((speaker) => (
            <SpeakerCard speaker={speaker} />
          ))}
        </div>
      )}
    </section>
  );
}

function OnStage({ talks }: { readonly talks: ReadonlyArray<Talk> }) {
  return (
    <Fact label="On stage">
      <div class="talks">
        {talks.map((talk) => (
          <TalkEntry talk={talk} />
        ))}
      </div>
    </Fact>
  );
}

/**
 * The evening's photos, at their own proportions. They are the originals,
 * loaded lazily; resized variants come with the image pipeline (/img/…).
 */
function Photos({ photos }: { readonly photos: ReadonlyArray<Rows.Photo> }) {
  return (
    <Fact label="Photos">
      <ul class="photos">
        {photos.map((photo) => (
          <li>
            <img
              src={photo.url}
              alt={photo.alt}
              width={String(photo.width)}
              height={String(photo.height)}
              loading="lazy"
              decoding="async"
            />
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

/** The whole page for `event`, in its mode unless the visitor fixed one. */
export function eventPage({
  event,
  origin,
  theme,
  portraits,
}: EventPageProps): string {
  const past = event.status === "past";
  const tagline = event.tagline.trim();
  return Document({
    title: lockupText(event),
    description:
      tagline === ""
        ? "An evening for people who build software, in San Francisco."
        : tagline,
    theme,
    pageTheme: dataTheme[event.mode],
    portraits,
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
          <HostedAt companies={event.hosts} portraits={portraits} />
          {!past && event.rsvpUrl !== null ? (
            <Seats rsvpUrl={event.rsvpUrl} seats={event.seats} />
          ) : (
            ""
          )}
          {past && event.recordingUrl !== null ? (
            <Recording url={event.recordingUrl} />
          ) : (
            ""
          )}
          {event.talks.length === 0 ? "" : <OnStage talks={event.talks} />}
          {/* Posts about the evening on socials go here, once the X
              integration lands. */}
          {past && event.photos.length > 0 ? (
            <Photos photos={event.photos} />
          ) : (
            ""
          )}
          {past ? <Next next={event.next} origin={origin} /> : ""}
        </dl>
      </article>
    ),
  });
}

/** Nothing published lives at this address: said plainly, with ways on. */
export function notFoundPage({
  theme,
  portraits,
}: Omit<EventPageProps, "event" | "origin">): string {
  return Document({
    title: "not found · all things/_",
    description: "No evening lives at this address.",
    theme,
    portraits,
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
  theme,
}: {
  readonly theme: Theme | undefined;
}): string {
  return Document({
    title: "all things/_",
    description: "Evenings for people who build software in San Francisco.",
    theme,
    portraits: new Map(),
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
