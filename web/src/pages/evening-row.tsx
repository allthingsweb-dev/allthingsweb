import type { Evening } from "allthings-core/src/home.ts";
import { DateTime } from "effect";
import { eventPath } from "../links.ts";
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

/**
 * at/<topic>, or the name as written when it has no topic, with the cursor
 * until the evening has happened: how lists and lines of text name an
 * evening.
 */
export function EveningName({
  evening,
}: {
  readonly evening: Pick<Evening, "name" | "topic" | "status">;
}) {
  const cursor = evening.status === "past" ? "" : <Cursor />;
  if (evening.topic === undefined) {
    return (
      <>
        <span safe>{evening.name}</span>
        {cursor}
      </>
    );
  }
  return (
    <>
      at<span class="slash">/</span>
      <span safe>{evening.topic}</span>
      {cursor}
    </>
  );
}

/** One evening, linking to its page on this site. */
export function EveningRow({ evening }: { readonly evening: Evening }) {
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
        <span class="name at-type-list-name">
          <EveningName evening={evening} />
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
