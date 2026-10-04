import type { Evening, HomeView } from "allthings-core/src/home.ts";
import { eventUrl } from "allthings-core/src/mappers.ts";
import type { PortraitsById } from "allthings-core/src/portraits.ts";
import type * as Rows from "allthings-core/src/rows.ts";
import { DateTime } from "effect";
import { everyEvening, lumaCalendar } from "../links.ts";
import { Document } from "./document.tsx";
import type { Theme } from "./theme.ts";
import { clockTime, day, listDate } from "./time.ts";

/**
 * /: the round-5 home. Each thing is said once. The next evening is the
 * hero (when, the lockup, where and who hosts, "I'm in"), community photos
 * sit beside it, and the band below holds the two sentences, the evenings
 * after that and the latest ones. With nothing announced, the hero is the
 * open slot, all things/_, and its button subscribes to the calendar.
 */

export interface HomeProps {
  readonly home: HomeView;
  /** Event pages and "every evening" are on the site at this origin. */
  readonly origin: string;
  readonly theme: Theme | undefined;
  /** The hosts' portraits, for the footer. */
  readonly portraits: PortraitsById;
}

/** The cursor means "not yet happened": upcoming and live evenings carry it. */
function Cursor() {
  return (
    <span class="at-cursor" aria-hidden="true">
      _
    </span>
  );
}

/**
 * How large the hero sets a lockup: "all things/" and a short topic at the
 * full size, longer topics a step down, a name that isn't a topic two.
 */
export function lockupSize(evening: Evening): "l" | "m" | "s" {
  if (evening.topic === undefined) return "s";
  return evening.topic.length <= "all things/".length ? "l" : "m";
}

/** at/<topic> in lists, or the name as written when it has no topic. */
function ListName({ evening }: { readonly evening: Evening }) {
  const cursor = evening.status === "past" ? "" : <Cursor />;
  if (evening.topic === undefined) {
    return (
      <span class="name at-type-list-name">
        <span safe>{evening.name}</span>
        {cursor}
      </span>
    );
  }
  return (
    <span class="name at-type-list-name">
      at<span class="slash">/</span>
      <span safe>{evening.topic}</span>
      {cursor}
    </span>
  );
}

/** The hosts as the label line names them: "Convex & Clerk", "A, B & C". */
export function hostNames(hosts: ReadonlyArray<string>): string {
  if (hosts.length <= 2) return hosts.join(" & ");
  return `${hosts.slice(0, -1).join(", ")} & ${hosts.at(-1) ?? ""}`;
}

function EveningRow({
  evening,
  origin,
}: {
  readonly evening: Evening;
  readonly origin: string;
}) {
  return (
    <li>
      <a class="row" href={eventUrl(origin, evening.slug)}>
        <time
          class="date at-type-meta"
          datetime={DateTime.formatIso(evening.startsAt)}
          safe
        >
          {listDate(evening.startsAt)}
        </time>
        <ListName evening={evening} />
        {evening.neighborhood === null ? (
          ""
        ) : (
          <span class="place at-type-list-place" safe>
            {evening.neighborhood}
          </span>
        )}
      </a>
    </li>
  );
}

function Hero({
  next,
  origin,
}: {
  readonly next: Evening;
  readonly origin: string;
}) {
  const label = [
    ...(next.neighborhood === null ? [] : [next.neighborhood]),
    ...(next.hosts.length === 0 ? [] : [hostNames(next.hosts)]),
  ].join(" · ");
  const when = `${next.status === "live" ? "Now" : "Next"} · ${day(next.startsAt)} · ${clockTime(next.startsAt)}`;
  return (
    <>
      <p class="at-type-meta">
        <time datetime={DateTime.formatIso(next.startsAt)} safe>
          {when}
        </time>
      </p>
      <div class="hero-lockup">
        {next.topic === undefined ? (
          <h1 id="next" class={`hero-name lockup-${lockupSize(next)}`}>
            <span safe>{next.name}</span>
            <Cursor />
          </h1>
        ) : (
          <h1 id="next" class={`hero-name lockup-${lockupSize(next)}`}>
            all things<span class="slash">/</span>
            <br />
            <span safe>{next.topic}</span>
            <Cursor />
          </h1>
        )}
        <div class="hero-foot">
          {label === "" ? (
            ""
          ) : (
            <p class="hero-label" safe>
              {label}
            </p>
          )}
          <a class="button" href={next.rsvpUrl ?? eventUrl(origin, next.slug)}>
            I’m in
            {next.rsvpUrl === null ? (
              ""
            ) : (
              <span class="visually-hidden">, on Luma</span>
            )}
            <span aria-hidden="true">→</span>
          </a>
        </div>
      </div>
    </>
  );
}

/** Nothing announced: the slot after the slash is open, and waits. */
function OpenSlot() {
  return (
    <>
      <p class="at-type-meta">Next · soon</p>
      <div class="hero-lockup">
        <h1 id="next" class="hero-name lockup-l">
          all things<span class="slash">/</span>
          <br />
          <Cursor />
        </h1>
        <div class="hero-foot">
          <p class="hero-label">San Francisco</p>
          <a class="button" href={lumaCalendar}>
            Subscribe on Luma <span aria-hidden="true">→</span>
          </a>
        </div>
      </div>
    </>
  );
}

function Mosaic({ photos }: { readonly photos: ReadonlyArray<Rows.Photo> }) {
  return (
    <div class={`mosaic tiles-${photos.length}`}>
      {photos.map((photo) => (
        <img
          src={photo.url}
          alt={photo.alt}
          width={String(photo.width)}
          height={String(photo.height)}
          loading="lazy"
          decoding="async"
        />
      ))}
    </div>
  );
}

export function homePage({
  home,
  origin,
  theme,
  portraits,
}: HomeProps): string {
  const { next, afterThat, recently, photos } = home;
  return Document({
    title: "all things/_",
    description:
      "Evenings for people who build software. In the neighborhoods of San Francisco.",
    theme,
    portraits,
    children: (
      <div class="home">
        <section
          class={photos.length === 0 ? "hero" : "hero with-photos"}
          aria-labelledby="next"
        >
          <div class="hero-text">
            {next === undefined ? (
              <OpenSlot />
            ) : (
              <Hero next={next} origin={origin} />
            )}
          </div>
          {photos.length === 0 ? "" : <Mosaic photos={photos} />}
        </section>
        <div class="band">
          <div class="pitch at-type-lead">
            <p>Evenings for people who build software.</p>
            <p class="pitch-place">In the neighborhoods of San Francisco.</p>
          </div>
          <div class={afterThat.length === 0 ? "lists" : "lists two"}>
            {afterThat.length === 0 ? (
              ""
            ) : (
              <section class="list after-that" aria-labelledby="after-that">
                <div class="list-head">
                  <h2 id="after-that" class="list-title at-type-meta">
                    After that
                  </h2>
                </div>
                <ol>
                  {afterThat.map((evening) => (
                    <EveningRow evening={evening} origin={origin} />
                  ))}
                </ol>
              </section>
            )}
            {recently.length === 0 ? (
              ""
            ) : (
              <section class="list recently" aria-labelledby="recently">
                <div class="list-head">
                  <h2 id="recently" class="list-title at-type-meta">
                    Recently
                  </h2>
                  <p class="list-links">
                    <a href={everyEvening(origin)}>
                      every evening <span aria-hidden="true">→</span>
                    </a>
                    {next === undefined ? (
                      ""
                    ) : (
                      <>
                        {" · "}
                        <a href={lumaCalendar}>subscribe on luma</a>
                      </>
                    )}
                  </p>
                </div>
                <ol>
                  {recently.map((evening) => (
                    <EveningRow evening={evening} origin={origin} />
                  ))}
                </ol>
              </section>
            )}
          </div>
        </div>
      </div>
    ),
  });
}

/**
 * The home page when its data can't be read: said plainly, never cached.
 * The hosts' portraits weren't read either, so the blank avatar stands in.
 */
export function unavailablePage({
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
          The evenings didn’t load. Try again in a minute.
        </p>
      </div>
    ),
  });
}
