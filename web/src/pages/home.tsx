import type { CommunityView } from "allthings-core/src/community.ts";
import type { Evening, HomeView } from "allthings-core/src/home.ts";
import type { PortraitsById } from "allthings-core/src/portraits.ts";
import { DateTime } from "effect";
import { eventPath, everyEvening, lumaCalendar } from "../links.ts";
import { Document } from "./document.tsx";
import { Cursor, EveningRow } from "./evening-row.tsx";
import { Tally } from "./figures.tsx";
import { homeTitle, siteDescription } from "./metadata.tsx";
import { organization } from "./structured-data.ts";
import type { ImageMode } from "./picture.tsx";
import { gridPhotos, SlashGrid } from "./slash-grid.tsx";
import type { Theme } from "./theme.ts";
import { ogCards } from "../og/cards.ts";
import { clockTime, day } from "./time.ts";

/**
 * /: the round-5 home, under the slash grid. Each thing is said once. The
 * next evening is the hero (when, the lockup, where and who hosts, "I'm
 * in"), the community's photos sit beside it cut on the slash's slant
 * (slash-grid.tsx), the tally runs under it as a band of numbers, and the
 * band below holds the two sentences, the evenings after that and the
 * latest ones. With nothing announced, the hero is the open slot,
 * allthings/_, and its button subscribes to the calendar.
 */

export interface HomeProps {
  readonly home: HomeView;
  /** The wall of photos and the tally (core's src/community.ts). */
  readonly community: CommunityView;
  /** The production origin, which the page's canonical URL is made from. */
  readonly origin: string;
  readonly theme: Theme | undefined;
  /** The hosts' portraits, for the footer. */
  readonly portraits: PortraitsById;
  /** How photos are shown (see picture.tsx). */
  readonly images: ImageMode;
}

/**
 * How large the hero sets a lockup: "allthings/" and a short topic at the
 * full size, longer topics a step down, a name that isn't a topic two.
 */
export function lockupSize(evening: Pick<Evening, "topic">): "l" | "m" | "s" {
  if (evening.topic === undefined) return "s";
  return evening.topic.length <= "allthings/".length ? "l" : "m";
}

/** The hosts as the label line names them: "Convex & Clerk", "A, B & C". */
export function hostNames(hosts: ReadonlyArray<string>): string {
  if (hosts.length <= 2) return hosts.join(" & ");
  return `${hosts.slice(0, -1).join(", ")} & ${hosts.at(-1) ?? ""}`;
}

/** Where the next evening is and who hosts it: "East Cut · CodeRabbit". */
export function nextLabel(next: Evening): string {
  return [
    ...(next.neighborhood === null ? [] : [next.neighborhood]),
    ...(next.hosts.length === 0 ? [] : [hostNames(next.hosts)]),
  ].join(" · ");
}

/** When the next evening is, live or ahead: "Next · Wed Sep 30 · 5:30 PM". */
export function NextWhen({ next }: { readonly next: Evening }) {
  const when = `${next.status === "live" ? "Now" : "Next"} · ${day(next.startsAt)} · ${clockTime(next.startsAt)}`;
  return (
    <p class="at-type-meta">
      <time datetime={DateTime.formatIso(next.startsAt)} safe>
        {when}
      </time>
    </p>
  );
}

/** "I'm in", to the next evening's Luma page, else its own. */
export function ImIn({ next }: { readonly next: Evening }) {
  return (
    <a class="button" href={next.rsvpUrl ?? eventPath(next.slug)}>
      I’m in
      {next.rsvpUrl === null ? (
        ""
      ) : (
        <span class="visually-hidden">, on Luma</span>
      )}
      <span aria-hidden="true">→</span>
    </a>
  );
}

/** The next evening as the hero: when, the lockup, where and who hosts, "I'm in". */
export function Hero({ next }: { readonly next: Evening }) {
  const label = nextLabel(next);
  return (
    <>
      <NextWhen next={next} />
      <div class="hero-lockup">
        {next.topic === undefined ? (
          <h1 id="next" class={`hero-name lockup-${lockupSize(next)}`}>
            <span safe>{next.name}</span>
            <Cursor />
          </h1>
        ) : (
          <h1 id="next" class={`hero-name lockup-${lockupSize(next)}`}>
            allthings<span class="slash">/</span>
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
          <ImIn next={next} />
        </div>
      </div>
    </>
  );
}

/** Nothing announced: the slot after the slash is open, and waits. */
export function OpenSlot() {
  return (
    <>
      <p class="at-type-meta">Next · soon</p>
      <div class="hero-lockup">
        <h1 id="next" class="hero-name lockup-l">
          allthings<span class="slash">/</span>
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

/**
 * What home shows below its hero: the two sentences beside the evenings
 * after the next one and the latest ones. The home lab's variants
 * (pages/lab/) show it under theirs.
 */
export function HomeBand({ home }: { readonly home: HomeView }) {
  const { next, afterThat, recently } = home;
  return (
    <div class="band">
      <div class="pitch at-type-statement">
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
                <EveningRow evening={evening} />
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
                <EveningRow evening={evening} />
              ))}
            </ol>
          </section>
        )}
      </div>
    </div>
  );
}

/**
 * Home under its hero: the next evening or the open slot beside the slash
 * grid, the tally as a band, then {@link HomeBand}. The home lab's
 * slash-grid (pages/lab/) shows the same.
 */
export function HomeParts({
  home,
  community,
  images,
}: {
  readonly home: HomeView;
  readonly community: CommunityView;
  readonly images: ImageMode;
}) {
  const photos = gridPhotos(community.wall, images);
  return (
    <>
      <section
        class={photos.length === 0 ? "hero" : "hero slash-cut"}
        aria-labelledby="next"
      >
        <div class="hero-text">
          {home.next === undefined ? <OpenSlot /> : <Hero next={home.next} />}
        </div>
        {photos.length === 0 ? (
          ""
        ) : (
          <SlashGrid photos={photos} images={images} />
        )}
      </section>
      <Tally tally={community.tally} kind="band" />
      <HomeBand home={home} />
    </>
  );
}

/** The whole home page for `home`, in the visitor's mode, signed off by the hosts. */
export function homePage({
  home,
  community,
  origin,
  theme,
  portraits,
  images,
}: HomeProps): string {
  return Document({
    meta: {
      title: homeTitle,
      description: siteDescription,
      path: "/",
      image: ogCards.home,
      structuredData: [organization(origin, siteDescription)],
    },
    origin,
    theme,
    portraits,
    images,
    section: "home",
    children: (
      <div class="home">
        <HomeParts home={home} community={community} images={images} />
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
  images,
  said = "The evenings didn’t load. Try again in a minute.",
}: {
  readonly origin: string;
  /** The page that couldn't be read, which stays its canonical URL. */
  readonly path: `/${string}`;
  readonly theme: Theme | undefined;
  readonly images: ImageMode;
  /** What didn't load, said plainly. */
  readonly said?: string;
}): string {
  return Document({
    meta: {
      title: homeTitle,
      description: siteDescription,
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
          allthings<span class="slash">/</span>
          <Cursor />
        </h1>
        <p class="lead at-type-lead" safe>
          {said}
        </p>
      </div>
    ),
  });
}
