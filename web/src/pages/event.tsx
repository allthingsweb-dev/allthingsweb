import {
  below,
  columns,
  contentVw,
  ledgerColumns,
  media,
  portrait as portraitSide,
  sizes,
  space,
} from "allthings-brand/src/layout.ts";
import type {
  EventPage,
  Note,
  Person,
  Post,
  ScheduleItem,
  Speaker,
  Talk,
  Venue,
} from "allthings-core/src/event-page.ts";
import type { Evening } from "allthings-core/src/home.ts";
import type { PortraitsById } from "allthings-core/src/portraits.ts";
import type * as Rows from "allthings-core/src/rows.ts";
import type { SafeHtml } from "allthings-core/src/rich-text.ts";
import { DateTime } from "effect";
import { httpUrlOrNull } from "allthings-core/src/mappers.ts";
import { built } from "../assets.ts";
import {
  eventPath,
  everyEvening,
  googleMaps,
  hosts,
  lumaCalendar,
  personUrl,
} from "../links.ts";
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
import { ogCards } from "../og/cards.ts";
import { eventCard } from "../og/event-card.ts";
import { day, fullDate, timeRange } from "./time.ts";

/**
 * /<slug>: an evening's page, the Ledger (design round EP1-B). The lockup,
 * then a ruled list that names every fact once, each on its own row under a
 * small label: when, where, who hosts, how to get in (or, once it is over,
 * the recording), what it is about, its schedule and any notes of its own
 * (a hackathon's awards, theme and teams), who is on stage (or that the
 * floor was open to anyone), the photos, what people posted about it, and
 * what comes next. A row whose facts are unknown is left out rather than
 * shown empty.
 *
 * Like every page, it is in the visitor's mode, the system's until they
 * choose one (brand/foundations.md, "Color"); the event's own mode is its
 * artwork's alone.
 */

export interface EventPageProps {
  readonly event: EventPage;
  /** The production origin: the page's canonical URL and structured data are on it. */
  readonly origin: string;
  /** The mode the visitor fixed, if any. */
  readonly theme: Theme | undefined;
  /** The hosts' portraits, for "your hosts" and the footer. */
  readonly portraits: PortraitsById;
  /** How photos are shown (see picture.tsx). */
  readonly images: ImageMode;
  /** When the page is made: its card names the year of an evening in another. */
  readonly now: DateTime.DateTime;
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
 * The squares site.css shows portraits at, from the layout tokens: hosts,
 * co-hosts and MCs small; speakers extra large, medium on phones. Each is
 * offered up to 3x.
 */
const portraitSizes = {
  small: {
    side: portraitSide.s,
    sides: [72, 144],
    sizes: `${portraitSide.s}px`,
  },
  speaker: {
    side: portraitSide.xl,
    sides: [72, 144, 168, 216, 336],
    sizes: `${below("l")} ${portraitSide.m}px, ${portraitSide.xl}px`,
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
              <a class="event-person-name" href={personUrl(person.id)}>
                <span safe>{person.name}</span>
              </a>
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

/**
 * The hosting companies, as hostNames lists them ("Mux, Strapi & Neon"),
 * each name linked to its own site where one is on record. Only used when
 * at least one is; otherwise the names print as plain text.
 */
function HostNames({
  names,
  sites,
}: {
  readonly names: ReadonlyArray<string>;
  readonly sites: Readonly<Record<string, string>>;
}) {
  return (
    <>
      {names.map((name, index) => {
        const site = sites[name];
        return (
          <>
            {index === 0 ? "" : index === names.length - 1 ? " &amp; " : ", "}
            {site === undefined ? (
              <span safe>{name}</span>
            ) : (
              <a href={site} safe>
                {name}
              </a>
            )}
          </>
        );
      })}
    </>
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
          ) : companies.some((name) => event.hostSites[name] !== undefined) ? (
            <p class="fact-head">
              <HostNames names={companies} sites={event.hostSites} />
            </p>
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

/**
 * Who organizes an evening we only share, linked to their site, and what
 * sharing it means; any hosting companies follow, as on our own evenings.
 */
function OrganizedBy({
  organizer,
  event,
  images,
}: {
  readonly organizer: Rows.Organizer;
  readonly event: EventPage;
  readonly images: ImageMode;
}) {
  const site = httpUrlOrNull(organizer.websiteUrl);
  return (
    <Fact label="Organized by">
      <>
        {site === null ? (
          <p class="fact-head" safe>
            {organizer.name}
          </p>
        ) : (
          <p class="fact-head">
            <a href={site} safe>
              {organizer.name}
            </a>
          </p>
        )}
        <p>{sharedNote}</p>
        {event.hosts.length === 0 ? (
          ""
        ) : (
          <p>
            hosted at <HostNames names={event.hosts} sites={event.hostSites} />
          </p>
        )}
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

/** What sharing an evening means, wherever the page says it is shared. */
export const sharedNote =
  "Not one of our evenings: we share it because we think it’s good.";

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
        <h3 class="at-type-list-name">
          <a href={personUrl(speaker.id)} safe>
            {speaker.name}
          </a>
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
        <div class="stage-speakers">
          {talk.speakers.map((speaker) => (
            <SpeakerCard speaker={speaker} images={images} />
          ))}
        </div>
      )}
    </section>
  );
}

/** The event's schedule: each step's time as written, then what happens. */
function Schedule({
  schedule,
}: {
  readonly schedule: ReadonlyArray<ScheduleItem>;
}) {
  return (
    <Fact label="Schedule">
      <ol class="schedule">
        {schedule.map((item) => (
          <li>
            <span class="schedule-time at-type-meta" safe>
              {item.time}
            </span>
            <div class="schedule-step">
              <p class="schedule-title" safe>
                {item.title}
              </p>
              {item.description === null ? (
                ""
              ) : (
                <p class="schedule-description" safe>
                  {item.description}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </Fact>
  );
}

/**
 * What the evening is about, in its own words: the site's description, or
 * the one on Luma.
 */
function About({ about }: { readonly about: SafeHtml }) {
  // Sanitized by core (rich-text.ts): formatting and safe links only.
  const safeAbout = about;
  return (
    <Fact label="About">
      <div class="event-about">{safeAbout}</div>
    </Fact>
  );
}

/** A row of the event's own, such as its awards, under the note's label. */
function NoteFact({ note }: { readonly note: Note }) {
  // Sanitized by core (rich-text.ts): formatting and safe links only.
  const safeBody = note.body;
  return (
    <Fact label={note.label}>
      <div class="note">{safeBody}</div>
    </Fact>
  );
}

/**
 * What an open floor is, in the evening's tense: there was no lineup, so
 * the demos the page lists, if any, are only the ones we know of.
 */
export function openFloorLine(status: EventPage["status"]): string {
  return status === "past"
    ? "Open floor: anyone could get up and show what they were building."
    : "Open floor: anyone can get up and show what they’re building.";
}

function OnStage({
  talks,
  openFloor,
  images,
}: {
  readonly talks: ReadonlyArray<Talk>;
  /** Said when the evening was an open floor, before any demos we know. */
  readonly openFloor: string | null;
  readonly images: ImageMode;
}) {
  return (
    <Fact label="On stage">
      <div class="stage">
        {openFloor === null ? (
          ""
        ) : (
          <p class="stage-open at-type-lead" safe>
            {openFloor}
          </p>
        )}
        {talks.map((talk) => (
          <TalkEntry talk={talk} images={images} />
        ))}
      </div>
    </Fact>
  );
}

/**
 * How wide site.css shows a photo: a third of the ledger's content columns,
 * and half the page's width where the ledger stacks.
 */
const photoSizes = sizes(
  { span: columns - ledgerColumns, parts: 3, gap: space(3) },
  { below: "l", span: columns, parts: 2, gap: space(3) },
);

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

/** How the page names a post's platform. */
const platformNames: Readonly<Record<Post["platform"], string>> = {
  x: "X",
  bluesky: "Bluesky",
  linkedin: "LinkedIn",
  other: "the web",
};

/**
 * How wide site.css shows a post's photo: at most the media size; where the
 * ledger stacks, the page's width less the author's avatar and its gap.
 */
const postPhotoSizes = `${below("l")} calc(${contentVw}vw - ${portraitSide.xs + space(3)}px), ${media}px`;

/** The author's avatar, extra small, or the brand's blank avatar. */
function PostAvatar({
  avatar,
  images,
}: {
  readonly avatar: Rows.Photo | null;
  readonly images: ImageMode;
}) {
  if (avatar === null || !hasSource(avatar, images)) {
    return (
      <img
        src={built.marks.avatar.src}
        alt=""
        width={String(portraitSide.xs)}
        height={String(portraitSide.xs)}
        loading="lazy"
        decoding="async"
      />
    );
  }
  return (
    <SquarePhoto
      photo={avatar}
      mode={images}
      side={portraitSide.xs}
      sides={[36, 72]}
      alt=""
    />
  );
}

/**
 * One post: who wrote it, what it says, its photo, and when and where, which
 * links to the post itself. Text only, as it was posted: no embed, no
 * script, nothing loaded from the platform.
 */
function PostEntry({
  post,
  images,
}: {
  readonly post: Post;
  readonly images: ImageMode;
}) {
  const author =
    post.authorUrl === null ? (
      <span class="post-author" safe>
        {post.authorName}
      </span>
    ) : (
      <a class="post-author" href={post.authorUrl}>
        <span safe>{post.authorName}</span>
      </a>
    );
  return (
    <li class="post">
      <PostAvatar avatar={post.avatar} images={images} />
      <div class="post-body">
        <p class="post-by">
          {author}
          {post.authorHandle === null ? (
            ""
          ) : (
            <span class="post-handle" safe>
              {`@${post.authorHandle.replace(/^@/, "")}`}
            </span>
          )}
        </p>
        <p class="post-text" safe>
          {post.text}
        </p>
        {post.image !== null && hasSource(post.image, images) ? (
          <Photo photo={post.image} mode={images} sizes={postPhotoSizes} />
        ) : (
          ""
        )}
        <p class="post-link at-type-meta">
          <a href={post.url}>
            <time datetime={DateTime.formatIso(post.postedAt)} safe>
              {day(post.postedAt)}
            </time>
            <span safe>{` on ${platformNames[post.platform]}`}</span>
            <span aria-hidden="true"> →</span>
          </a>
        </p>
      </div>
    </li>
  );
}

/**
 * Where more posts about the evening are, when the page lists only some:
 * a search of X for its Luma page, which posts about it link.
 */
export function morePostsUrl(rsvpUrl: string | null): string | null {
  return rsvpUrl === null
    ? null
    : `https://x.com/search?q=${encodeURIComponent(rsvpUrl)}&f=live`;
}

/** What people posted about the evening, earliest first. */
function Posts({
  posts,
  more,
  rsvpUrl,
  images,
}: {
  readonly posts: ReadonlyArray<Post>;
  readonly more: number;
  readonly rsvpUrl: string | null;
  readonly images: ImageMode;
}) {
  const moreUrl = more > 0 ? morePostsUrl(rsvpUrl) : null;
  return (
    <Fact label="Posts">
      <>
        <ul class="posts">
          {posts.map((post) => (
            <PostEntry post={post} images={images} />
          ))}
        </ul>
        {moreUrl === null ? (
          ""
        ) : (
          <p class="fact-links">
            <a href={moreUrl}>
              more on X <span aria-hidden="true">→</span>
            </a>
          </p>
        )}
      </>
    </Fact>
  );
}

/** After an evening: the next one, or the open slot and the calendar. */
function Next({ next }: { readonly next: Evening | undefined }) {
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
          <a href={eventPath(next.slug)}>
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
  images,
  now,
}: EventPageProps): string {
  const past = event.status === "past";
  const photos = showable(event.photos, images);
  const tagline = event.tagline.trim();
  return Document({
    section: "events",
    meta: {
      title: eventTitle(event),
      description:
        tagline === ""
          ? "An evening for people who build software, in San Francisco."
          : tagline,
      path: eventPath(event.slug),
      image: eventCard(event, eventTitle(event), now),
      structuredData: [eventStructuredData(event, origin)],
    },
    origin,
    theme,
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
          {event.curation.kind === "shared" ? (
            <OrganizedBy
              organizer={event.curation.organizer}
              event={event}
              images={images}
            />
          ) : (
            <HostedAt event={event} portraits={portraits} images={images} />
          )}
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
          {event.about === null ? "" : <About about={event.about} />}
          {event.schedule.length === 0 ? (
            ""
          ) : (
            <Schedule schedule={event.schedule} />
          )}
          {event.notes.map((note) => (
            <NoteFact note={note} />
          ))}
          {event.program === "open-floor" ? (
            <OnStage
              talks={event.talks}
              openFloor={openFloorLine(event.status)}
              images={images}
            />
          ) : event.program !== "talks" || event.talks.length === 0 ? (
            ""
          ) : (
            <OnStage talks={event.talks} openFloor={null} images={images} />
          )}
          {past && photos.length > 0 ? (
            <Photos photos={photos} images={images} />
          ) : (
            ""
          )}
          {event.posts.length === 0 ? (
            ""
          ) : (
            <Posts
              posts={event.posts}
              more={event.morePosts}
              rsvpUrl={event.rsvpUrl}
              images={images}
            />
          )}
          {past ? <Next next={event.next} /> : ""}
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

/** Why nothing is at an address: there never was, or it is gone. */
const nothingHere = {
  404: {
    status: "404 · not found",
    title: "not found",
    lead: "No evening lives at this address.",
  },
  410: {
    status: "410 · gone",
    title: "gone",
    lead: "What lived at this address is gone for good.",
  },
} as const;

/**
 * Nothing published lives at this address, or what did is gone (410): said
 * plainly, with ways on.
 */
export function notFoundPage({
  origin,
  path,
  theme,
  portraits,
  images,
  status = 404,
}: StandInProps & {
  readonly portraits: PortraitsById;
  /** 410 for what the site retired; 404 otherwise. */
  readonly status?: 404 | 410;
}): string {
  const said = nothingHere[status];
  return Document({
    meta: {
      title: gatheringTitle(said.title),
      description: said.lead,
      path,
      image: ogCards.notFound,
    },
    origin,
    theme,
    portraits,
    images,
    children: (
      <div class="intro">
        <p class="at-type-meta">{said.status}</p>
        <h1 class="lockup at-type-event-lockup">
          all things<span class="slash">/</span>
          <Cursor />
        </h1>
        <p class="lead at-type-lead">{said.lead}</p>
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
      image: ogCards.home,
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
