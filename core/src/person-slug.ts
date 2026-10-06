/**
 * A person's slug, as /people/<slug> addresses them: the database's
 * person_slug(name) (migrations/0017_person_slugs.ts), which sets every
 * profile's slug. This is the same function, for code that needs a slug
 * before the database has given one; tests/person-slug.test.ts holds the
 * two to each other.
 */

/** Letters spelled with more than one plain letter. */
const spelled: ReadonlyArray<readonly [string, string]> = [
  ["ß", "ss"],
  ["æ", "ae"],
  ["œ", "oe"],
  ["þ", "th"],
  ["ð", "d"],
];

/** Letters with marks, and the plain letter each stands for. */
const marked =
  "àáâãäåāăąçćčďđèéêëēĕėęěìíîïĩīįıłñńňòóôõöøōőŕřśšşťùúûüũūůűųýÿźżž";
const plain = "aaaaaaaaacccddeeeeeeeeeiiiiiiiilnnnoooooooorrssstuuuuuuuuuyyzzz";

// Each is one code point, as SQL's translate() reads them.
const folds = new Map(
  Array.from(marked, (letter, index) => [letter, plain[index] ?? letter]),
);
const foldable = new RegExp(`[${marked}]`, "gu");

/** The longest slug: past it, a name is cut, at no particular word. */
export const slugLength = 64;

/** What a person whose name has no Latin letter or digit is called. */
export const fallbackSlug = "person";

/** A slug's shape: lowercase letters and digits, single hyphens between. */
export const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function personSlug(name: string): string {
  let text = name.toLowerCase();
  for (const [letter, spelling] of spelled) {
    text = text.replaceAll(letter, spelling);
  }
  const slug = text
    .replace(foldable, (letter) => folds.get(letter) ?? letter)
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, slugLength)
    .replace(/^-+|-+$/g, "");
  return slug === "" ? fallbackSlug : slug;
}
