import {
  type Letter,
  type Part,
  itemsOf,
  plainText,
  proseParts,
  sectionOrder,
  sectionTitles,
  sourceUrl,
} from "allthings-core/src/letter.ts";
import type { PortraitsById } from "allthings-core/src/portraits.ts";
import { issuePath, letterPath, lumaCalendar } from "../links.ts";
import { ogCards } from "../og/cards.ts";
import { Document } from "./document.tsx";
import { gatheringTitle } from "./metadata.tsx";
import type { ImageMode } from "./picture.tsx";
import type { Theme } from "./theme.ts";
import { simpleDate, simpleMonth } from "./time.ts";

/**
 * /letter and /letter/<yyyy-mm>: the allthings letter (core's
 * src/letter.ts), one a month, as its archive. Only the issues Erik
 * approved are here, exactly as he read them (`publishedLetters`): a
 * draft has no page, no line in the index and no place in the sitemap.
 *
 * An issue reads as it does in the email: its title, then each section
 * in the letter's order under its heading, each item its name (linking
 * what it names) and a paragraph, then the closing, set larger, and who
 * wrote it and when Erik approved it. Like /guide and /coach, it stays out
 * of the header, which has no room for another section at 320 pixels.
 */

interface PageProps {
  /** The production origin, which the page's canonical URL is made from. */
  readonly origin: string;
  readonly theme: Theme | undefined;
  /** The hosts' portraits, for the footer. */
  readonly portraits: PortraitsById;
  readonly images: ImageMode;
}

/** What the letter is, in the index's lead and every page's description. */
const about =
  "One letter a month from allthings: our next evenings, what's worth your time beyond them, and a closing paragraph.";

/** A paragraph's words and links. */
function Prose({ parts }: { readonly parts: ReadonlyArray<Part> }) {
  return (
    <>
      {parts.map((part) =>
        "href" in part ? (
          <a href={part.href} safe>
            {part.text}
          </a>
        ) : (
          <span safe>{part.text}</span>
        ),
      )}
    </>
  );
}

/** Who wrote an issue, and the day Erik said y to it. */
function Colophon({ letter }: { readonly letter: Letter }) {
  return (
    <p class="at-type-meta">
      written by claude · approved by erik{" "}
      <time datetime={letter.approved.on} safe>
        {simpleDate(letter.approved.on)}
      </time>
    </p>
  );
}

/** One issue, whole. */
export function issuePage({
  letter,
  origin,
  theme,
  portraits,
  images,
}: PageProps & { readonly letter: Letter }): string {
  return Document({
    meta: {
      title: gatheringTitle(`${letter.title} · the letter`),
      description: plainText(
        itemsOf(letter)
          .map(({ item }) => item.name)
          .join(", ") || about,
      ),
      path: issuePath(letter.month),
      image: ogCards.letter,
    },
    origin,
    theme,
    portraits,
    images,
    children: (
      <article class="letter">
        <div class="intro">
          <p class="at-type-meta">
            <a href={letterPath}>the letter</a> ·{" "}
            <time datetime={letter.month} safe>
              {simpleMonth(letter.month)}
            </time>
          </p>
          <h1 class="lockup at-type-event-lockup" safe>
            {letter.title}
          </h1>
        </div>
        <div class="prose">
          {sectionOrder.map((key) => {
            const items = letter[key];
            return items === undefined ? (
              ""
            ) : (
              <>
                <h2 id={key} safe>
                  {sectionTitles[key]}
                </h2>
                {items.map((item) => (
                  <p>
                    <strong>
                      <a href={sourceUrl(item.source)} safe>
                        {item.name}
                      </a>
                    </strong>{" "}
                    <Prose parts={proseParts(item.text)} />
                  </p>
                ))}
              </>
            );
          })}
          {letter.closing === undefined ? (
            ""
          ) : (
            <p class="at-type-statement">
              <Prose parts={proseParts(letter.closing)} />
            </p>
          )}
          <Colophon letter={letter} />
          <p class="fact-links">
            <a href={letterPath}>
              every letter <span aria-hidden="true">→</span>
            </a>
          </p>
        </div>
      </article>
    ),
  });
}

/** The archive: every issue Erik approved, newest first. */
export function letterIndexPage({
  letters,
  origin,
  theme,
  portraits,
  images,
}: PageProps & { readonly letters: ReadonlyArray<Letter> }): string {
  return Document({
    meta: {
      title: gatheringTitle("the letter"),
      description: about,
      path: letterPath,
      image: ogCards.letter,
    },
    origin,
    theme,
    portraits,
    images,
    children: (
      <div class="evenings">
        <div class="evenings-head">
          <h1 class="lockup at-type-event-lockup">the letter</h1>
          <p class="lead at-type-lead">
            {about}
          </p>
          <p>
            Claude writes it, and Erik reads every word before it goes out to
            everyone subscribed to our calendar on Luma.
          </p>
          <p class="fact-links">
            <a href={lumaCalendar}>
              subscribe on luma <span aria-hidden="true">→</span>
            </a>
          </p>
        </div>
        <div class="evenings-lists">
          <section class="list" aria-labelledby="every-letter">
            <div class="list-head">
              <h2 id="every-letter" class="list-title at-type-meta">
                every letter
              </h2>
            </div>
            {letters.length === 0 ? (
              <p>The first one hasn't gone out yet.</p>
            ) : (
              <ol class="talks">
                {letters.map((letter) => (
                  <li>
                    <h3 class="at-type-list-name">
                      <a href={issuePath(letter.month)} safe>
                        {letter.title}
                      </a>
                    </h3>
                    <p class="at-type-meta">
                      <time datetime={letter.month} safe>
                        {simpleMonth(letter.month)}
                      </time>
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </div>
    ),
  });
}
