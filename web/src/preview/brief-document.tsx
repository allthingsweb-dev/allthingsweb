import type { EventPage } from "allthings-core/src/event-page.ts";
import type { PortraitsById } from "allthings-core/src/portraits.ts";
import type { DateTime } from "effect";
import { eventCard } from "../og/event-card.ts";
import { Document } from "../pages/document.tsx";
import { Cursor } from "../pages/evening-row.tsx";
import { eventTitle } from "../pages/event.tsx";
import type { ImageMode } from "../pages/picture.tsx";
import type { Theme } from "../pages/theme.ts";
import { simpleDate } from "../pages/time.ts";
import { briefHtml } from "./brief.ts";
import type { Section } from "./collab.ts";
import { roleName } from "./panel.tsx";

/**
 * `/<slug>/brief` on the draft preview (app.ts): an evening's brief as one
 * document, to read through, hand to a co-host, or print and save as a
 * PDF. It holds the same sections the panel under the evening's page shows
 * the signer, and no others: the brief's audiences decide, as there
 * (core's README, "Collaborating on a draft").
 *
 * The cover is the evening's artwork, so it is in the evening's mode
 * (brand/foundations.md, "An event's artwork has its mode"): Night for an
 * evening, Paper for a daytime one. Then each section is a row of the
 * ledger, its number and heading in the label's three columns and its body
 * at a reading measure in the other nine. Printed, the cover fills the
 * first page, each section starts on a new one, and the site's header,
 * footer and links back stay off the paper.
 */

export interface BriefDocumentProps {
  readonly event: EventPage;
  /** The sections the signer may see, in the brief's order. */
  readonly sections: ReadonlyArray<Pick<Section, "heading" | "body">>;
  /** The signer's roles on the evening: who the document says it is for. */
  readonly roles: ReadonlyArray<string>;
  /** Whether the evening is still a draft. */
  readonly draft: boolean;
  /** The production origin, which the page's canonical URL is made from. */
  readonly origin: string;
  readonly theme: Theme | undefined;
  readonly portraits: PortraitsById;
  readonly images: ImageMode;
  /** When the page is made: the date the cover says it is as of. */
  readonly now: DateTime.DateTime;
}

/** Where the brief as one document is, beside the evening's page on the preview. */
export const briefPath = (slug: string): `/${string}` =>
  `/${encodeURIComponent(slug)}/brief`;

/** A section's number, two digits, as the document and its contents give it. */
export const sectionNumber = (index: number): string =>
  String(index + 1).padStart(2, "0");

/** Whether an evening starts in the daytime in San Francisco, as its artwork's mode is chosen. */
function daytime(event: EventPage): boolean {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      hour: "numeric",
      hourCycle: "h23",
    }).format(new Date(event.startsAt.epochMilliseconds)),
  );
  return hour >= 5 && hour < 16;
}

/** The evening's lockup, as its page sets it: allthings/ over the topic, or its name. */
function CoverLockup({ event }: { readonly event: EventPage }) {
  const cursor = event.status === "past" ? "" : <Cursor />;
  if (event.topic === undefined) {
    return (
      <h1 class="brief-lockup brief-lockup-name">
        <span safe>{event.name}</span>
        {cursor}
      </h1>
    );
  }
  return (
    <h1 class="brief-lockup">
      allthings<span class="slash">/</span>
      <br />
      <span safe>{event.topic}</span>
      {cursor}
    </h1>
  );
}

/** The brief as one document, whole, in the site's frame. */
export function briefDocumentPage({
  event,
  sections,
  roles,
  draft,
  origin,
  theme,
  portraits,
  images,
  now,
}: BriefDocumentProps): string {
  const title = eventTitle(event);
  const evening: `/${string}` = `/${encodeURIComponent(event.slug)}`;
  // Who it is for, as many: organizers, round hosts.
  const forWhom = roles.map((role) => `${roleName(role)}s`).join(", ");
  return Document({
    section: "events",
    meta: {
      title,
      description: `The brief for ${title}.`,
      path: evening,
      image: eventCard(event, title, now),
      noindex: true,
    },
    origin,
    theme,
    portraits,
    images,
    children: (
      <article class="brief-doc">
        <header
          class="brief-cover"
          data-theme={daytime(event) ? "light" : "dark"}
        >
          <div class="brief-cover-top at-type-meta">
            <p>the brief</p>
            <p safe>
              {`${draft ? "a draft" : "published"} · not public · ${forWhom === "" ? "for you" : `for ${forWhom}`}`}
            </p>
          </div>
          <CoverLockup event={event} />
          <div class="brief-cover-foot">
            {sections.length === 0 ? (
              ""
            ) : (
              <nav class="brief-contents" aria-label="contents">
                <ol>
                  {sections.map((section, index) => (
                    <li>
                      <a href={`#brief-${index + 1}`}>
                        <span class="brief-number at-type-meta" safe>
                          {sectionNumber(index)}
                        </span>
                        <span safe>{section.heading}</span>
                      </a>
                    </li>
                  ))}
                </ol>
              </nav>
            )}
            <p class="brief-asof at-type-meta">
              as of{" "}
              <time datetime={simpleDate(now).replaceAll(".", "-")} safe>
                {simpleDate(now)}
              </time>
            </p>
          </div>
        </header>
        {sections.length === 0 ? (
          <p class="brief-empty">
            This evening has no brief yet. Its organizers write one in the
            studio.
          </p>
        ) : (
          <div class="brief-sections">
            {sections.map((section, index) => {
              const safeBody = briefHtml(section.body, "document");
              return (
                <section
                  class="brief-section"
                  id={`brief-${index + 1}`}
                  aria-labelledby={`brief-${index + 1}-heading`}
                >
                  <div class="brief-section-head">
                    <p class="brief-number at-type-meta" safe>
                      {sectionNumber(index)}
                    </p>
                    <h2 id={`brief-${index + 1}-heading`} safe>
                      {section.heading}
                    </h2>
                  </div>
                  <div class="brief-body">{safeBody}</div>
                </section>
              );
            })}
          </div>
        )}
        <p class="brief-back">
          <a href={evening}>
            comment on any section under the evening's page →
          </a>
        </p>
      </article>
    ),
  });
}
