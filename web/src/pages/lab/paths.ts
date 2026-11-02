/**
 * Where the lab's pages are (pages/lab/), apart from the pages themselves,
 * which the Worker loads only when one is asked for.
 */

/** The lab's root: every exploration (labs.tsx). */
export const labRoot = "/lab";

/** The home lab's index. */
export const labPath = "/lab/home";

/** The Now lab's index: every person with a "now" record (docs/now.md). */
export const nowLabPath = "/lab/now";

/** A person's page with its Now section, in the lab. */
export const nowLabPersonPath = (slug: string): `/${string}` =>
  `${nowLabPath}/${slug}`;

/** A variant's page. */
export const variantPath = (name: string): `/${string}` => `${labPath}/${name}`;
