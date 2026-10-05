import type { Evening, HomeView } from "allthings-core/src/home.ts";
import { eventUrl } from "allthings-core/src/mappers.ts";
import type { PortraitsById } from "allthings-core/src/portraits.ts";
import type * as Rows from "allthings-core/src/rows.ts";
import { DateTime } from "effect";
import { everyEvening, lumaCalendar } from "../links.ts";
import { Document } from "./document.tsx";
import { Cursor, EveningRow } from "./evening-row.tsx";
import { homeTitle, siteDescription } from "./metadata.tsx";
import { organization } from "./structured-data.ts";
import type { Theme } from "./theme.ts";
import { clockTime, day } from "./time.ts";

/**
 * /: the round-5 home. Each thing is said once. The next evening is the
 * hero (when, the lockup, where and who hosts, "I'm in"), community photos
 * sit beside it, and the band below holds the two sentences, the evenings
 * after that and the latest ones. With nothing announced, the hero is the
 * open slot, all things/_, and its button subscribes to the calendar.
 */

export interface HomeProps {
  readonly home: HomeView;
  /** Event pages are on the site at this origin. */
  readonly origin: string;
  readonly theme: Theme | undefined;
  /** The hosts' portraits, for the footer. */
  readonly portraits: PortraitsById;
}

/**
 * How large the hero sets a lockup: "all things/" and a short topic at the
 * full size, longer topics a step down, a name that isn't a topic two.
 */
export function lockupSize(evening: Evening): "l" | "m" | "s" {
  if (evening.topic === undefined) return "s";
  return evening.topic.length <= "all things/".length ? "l" : "m";
}

/** The hosts as the label line names them: "Convex & Clerk", "A, B & C". */
export function hostNames(hosts: ReadonlyArray<string>): string {
  if (hosts.length <= 2) return hosts.join(" & ");
  return `${hosts.slice(0, -1).join(", ")} & ${hosts.at(-1) ?? ""}`;
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

/** The whole home page for `home`, in the visitor's mode, signed off by the hosts. */
export function homePage({
  home,
  origin,
  theme,
  portraits,
}: HomeProps): string {
  const { next, afterThat, recently, photos } = home;
  return Document({
    meta: {
      title: homeTitle,
      description: siteDescription,
      path: "/",
      structuredData: [organization(origin, siteDescription)],
    },
    origin,
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
                    <a href={everyEvening}>
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
 * A page when its data can't be read (the home page, the evenings index):
 * said plainly at its own path, never cached.
 * The hosts' portraits weren't read either, so the blank avatar stands in.
 */
export function unavailablePage({
  origin,
  path,
  theme,
}: {
  readonly origin: string;
  /** The page that couldn't be read, which stays its canonical URL. */
  readonly path: `/${string}`;
  readonly theme: Theme | undefined;
}): string {
  return Document({
    meta: { title: homeTitle, description: siteDescription, path },
    origin,
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
