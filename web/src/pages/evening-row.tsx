import type { Evening } from "allthings-core/src/home.ts";
import { eventUrl } from "allthings-core/src/mappers.ts";
import { DateTime } from "effect";
import { listDate } from "./time.ts";

/**
 * An evening as every list shows it (brand/foundations.md, "Layout"): a
 * light date, the name heavy with its slash, and the neighborhood bolder
 * than the date but clearly secondary. Home and the evenings index share
 * it, so a row reads the same wherever it is.
 */

/** The cursor means "not yet happened": upcoming and live evenings carry it. */
export function Cursor() {
  return (
    <span class="at-cursor" aria-hidden="true">
      _
    </span>
  );
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

/** One evening, linking to its page on the site at `origin`. */
export function EveningRow({
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
