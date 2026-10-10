/**
 * Where the lab's pages are (pages/lab/), apart from the pages themselves,
 * which the Worker loads only when one is asked for.
 */

/** The lab's root: every exploration (labs.tsx). */
export const labRoot = "/lab";

/** The home lab's index. */
export const labPath = "/lab/home";

/** A variant's page. */
export const variantPath = (name: string): `/${string}` => `${labPath}/${name}`;
