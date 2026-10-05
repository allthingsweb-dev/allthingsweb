import type { AboutView, Organizer } from "allthings-core/src/about.ts";
import type { Evening } from "allthings-core/src/home.ts";
import type { PortraitsById } from "allthings-core/src/portraits.ts";
import { DateTime } from "effect";
import {
  aboutPath,
  discord,
  eventPath,
  everyEvening,
  lumaCalendar,
  personUrl,
  socials,
} from "../links.ts";
import { Document } from "./document.tsx";
import { gatheringTitle, siteDescription } from "./metadata.tsx";
import { Portrait } from "./people.tsx";
import type { ImageMode } from "./picture.tsx";
import type { Theme } from "./theme.ts";
import { ogCards } from "../og/cards.ts";
import { fullDate, listDate } from "./time.ts";

/**
 * /about: what all things is, in the foundations' words ("Who we are"),
 * what it has done so far, counted from the data, where it came from (the
 * one place its former names appear, brand/foundations.md, "Name"), who
 * organizes it, how to host an evening or take the stage, and where else
 * it is. Every number and date comes from the evenings themselves.
 */

export interface AboutProps {
  readonly about: AboutView;
  /** The production origin, which the page's canonical URL is made from. */
  readonly origin: string;
  readonly theme: Theme | undefined;
  /** The hosts' portraits, for the footer. */
  readonly portraits: PortraitsById;
  /** How photos are shown (see picture.tsx). */
  readonly images: ImageMode;
}

/** "6,123": a count as the page prints it, whatever the runtime's locale. */
export function count(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** One section of the page: a caps label over what it says. */
function Part({
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
      <h2 id={id} class="list-title at-type-meta" safe>
        {title}
      </h2>
      {children}
    </section>
  );
}

/** What has happened so far, each number counted from the evenings held. */
function SoFar({ about }: { readonly about: AboutView }) {
  const tally = [
    { value: about.evenings, label: "evenings" },
    { value: about.speakers, label: "people on stage" },
    { value: about.hostingCompanies, label: "hosting companies" },
    { value: about.guests, label: "guests, as Luma counted them" },
  ].filter(({ value }) => value > 0);
  if (tally.length === 0) return "";
  return (
    <Part id="so-far" title="So far">
      <>
        <dl class="tally">
          {tally.map(({ value, label }) => (
            <div>
              <dt class="at-type-meta" safe>
                {label}
              </dt>
              <dd safe>{count(value)}</dd>
            </div>
          ))}
        </dl>
        {about.first === undefined ? (
          ""
        ) : (
          <p class="about-note at-type-meta">
            since{" "}
            <time datetime={DateTime.formatIso(about.first.startsAt)} safe>
              {fullDate(about.first.startsAt)}
            </time>
          </p>
        )}
      </>
    </Part>
  );
}

/** "A", "A and B", "A, B and C". */
function series(names: ReadonlyArray<string>): string {
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;
}

/** An evening as history lists it: its date, its name as written, where. */
function HistoryRow({ evening }: { readonly evening: Evening }) {
  return (
    <li>
      <a class="row" href={eventPath(evening.slug)}>
        <time
          class="date at-type-meta"
          datetime={DateTime.formatIso(evening.startsAt)}
          safe
        >
          {listDate(evening.startsAt)}
        </time>
        <span class="name at-type-list-name" safe>
          {evening.name}
        </span>
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

/**
 * Where it came from: the names the evenings went by before, each with the
 * first evening under it. The one place on the site those names appear.
 */
function History({ about }: { readonly about: AboutView }) {
  const names = about.formerNames.map(({ name }) => name);
  return (
    <Part id="history" title="History">
      <>
        <p>
          Erik and Andre started these evenings to bring San Francisco’s meetups
          back after the pandemic had emptied them, in the spirit of an old
          hacker club, with the tools and ideas of today.
        </p>
        {names.length === 0 ? (
          ""
        ) : (
          <>
            <p safe>
              {`Before they were all things, they went by ${series(names)}. Now there is one name, and each evening fills the slot after the slash.`}
            </p>
            <ol class="history">
              {about.formerNames.map(({ evening }) => (
                <HistoryRow evening={evening} />
              ))}
            </ol>
          </>
        )}
      </>
    </Part>
  );
}

/** A profile's links in the order shown, each named as the footer names it. */
const linkOrder = ["x", "bluesky", "linkedin"] as const satisfies ReadonlyArray<
  keyof Organizer["links"]
>;

/** An organizer, whole, as their profile has them. */
function OrganizerEntry({
  organizer,
  images,
}: {
  readonly organizer: Organizer;
  readonly images: ImageMode;
}) {
  const links = linkOrder.flatMap((key) => {
    const href = organizer.links[key];
    return href === null ? [] : [{ href, name: key }];
  });
  return (
    <li class="person">
      <Portrait
        photo={organizer.photo}
        organizer
        images={images}
        eager={undefined}
      />
      <div class="person-text">
        <h3 class="person-name">
          <a href={personUrl(organizer.id)} safe>
            {organizer.name}
          </a>
        </h3>
        {organizer.title === null ? (
          ""
        ) : (
          <p class="person-title at-type-meta" safe>
            {organizer.title}
          </p>
        )}
        {organizer.bio === null ? (
          ""
        ) : (
          <p class="person-bio" safe>
            {organizer.bio}
          </p>
        )}
        {links.length === 0 ? (
          ""
        ) : (
          <ul class="person-links at-type-meta">
            {links.map((link) => (
              <li>
                <a href={link.href}>
                  <span>{link.name}</span>
                  <span class="visually-hidden" safe>
                    {`, ${organizer.name}`}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

/** The whole about page, in the visitor's mode. */
export function aboutPage({
  about,
  origin,
  theme,
  portraits,
  images,
}: AboutProps): string {
  return Document({
    section: "about",
    meta: {
      title: gatheringTitle("about"),
      description: siteDescription,
      path: aboutPath,
      image: ogCards.about,
    },
    origin,
    theme,
    portraits,
    images,
    children: (
      <div class="about">
        <div class="about-head">
          <h1 class="lockup at-type-event-lockup">about</h1>
          <div class="pitch at-type-lead">
            <p>Evenings for people who build software.</p>
            <p class="pitch-place">In the neighborhoods of San Francisco.</p>
          </div>
        </div>
        <div class="about-parts">
          <Part id="who" title="Who we are">
            <>
              <p class="about-lead at-type-lead">
                An open door and a high bar.
              </p>
              <p>
                all things is an open community for people who build software in
                San Francisco: the person a month into their first job, the
                maintainer of a library you install every day, the founder, the
                creator, and everyone between. Everyone is welcome. What goes on
                stage has earned its place.
              </p>
              <p>
                Hosting companies give space, food and drinks. We have never
                taken money or sold a stage, so we never call anyone a sponsor.
              </p>
            </>
          </Part>
          <SoFar about={about} />
          <History about={about} />
          {about.organizers.length === 0 ? (
            ""
          ) : (
            <Part id="organizers" title="Organizers">
              <ul class="organizers">
                {about.organizers.map((organizer) => (
                  <OrganizerEntry organizer={organizer} images={images} />
                ))}
              </ul>
            </Part>
          )}
          <Part id="host" title="Host an evening">
            <>
              <p>
                A hosting company gives an evening its room, its food and its
                drinks. We bring the people and the talks. Nobody buys a slot on
                stage.
              </p>
              <p class="fact-links">
                <a href={discord}>
                  ask on discord <span aria-hidden="true">→</span>
                </a>
              </p>
            </>
          </Part>
          <Part id="stage" title="Take the stage">
            <>
              <p>
                Show what you built and how. A talk earns its place by what the
                room takes home, not by who gives it.
              </p>
              <p class="fact-links">
                <a href={discord}>
                  pitch a talk on discord <span aria-hidden="true">→</span>
                </a>
              </p>
            </>
          </Part>
          <Part id="elsewhere" title="Elsewhere">
            <>
              <ul class="socials at-type-meta">
                {socials.map((social) => (
                  <li>
                    <a href={social.href} safe>
                      {social.name}
                    </a>
                  </li>
                ))}
              </ul>
              <p class="fact-links">
                <a href={lumaCalendar}>subscribe on luma</a>
                {" · "}
                <a href={everyEvening}>
                  every evening <span aria-hidden="true">→</span>
                </a>
              </p>
            </>
          </Part>
        </div>
      </div>
    ),
  });
}
