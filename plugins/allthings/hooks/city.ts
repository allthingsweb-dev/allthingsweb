/**
 * San Francisco, as the mod names it: the neighborhoods the spinner wanders
 * through, and the one an evening's venue stands in.
 *
 * Only real neighborhoods, by the names locals use (brand/foundations.md,
 * "Places"): FiDi, not the Financial District.
 */

/** A neighborhood and how a sentence names it ("in the Mission"). */
type Hood = { name: string; inSentence: string };

const hood = (name: string, article = ""): Hood => ({
  name,
  inSentence: article ? `${article} ${name}` : name,
});

/** The spinner's walk through the city, in order. */
export const NEIGHBORHOODS: readonly Hood[] = [
  hood("SoMa"),
  hood("Mission", "the"),
  hood("Dogpatch"),
  hood("Tenderloin", "the"),
  hood("FiDi"),
  hood("East Cut"),
  hood("Potrero Hill"),
  hood("Mission Bay"),
  hood("Hayes Valley"),
  hood("North Beach"),
  hood("Chinatown"),
  hood("Nob Hill"),
  hood("Russian Hill"),
  hood("Union Square"),
  hood("Mid-Market"),
  hood("Japantown"),
  hood("Castro", "the"),
  hood("Noe Valley"),
  hood("Bernal Heights"),
  hood("Glen Park"),
  hood("Haight", "the"),
  hood("Cole Valley"),
  hood("NoPa"),
  hood("Richmond", "the"),
  hood("Sunset", "the"),
  hood("Marina", "the"),
  hood("Cow Hollow"),
  hood("Pacific Heights"),
  hood("Jackson Square"),
  hood("Telegraph Hill"),
  hood("Excelsior", "the"),
  hood("Bayview"),
  hood("Presidio", "the"),
  hood("Duboce Triangle"),
  hood("Lower Haight"),
  hood("Western Addition", "the"),
];

/** What the spinner says someone is doing there, and the preposition it takes. */
const WORK: readonly (readonly [verb: string, preposition: string])[] = [
  ["shipping", "in"],
  ["pairing", "in"],
  ["debugging", "in"],
  ["refactoring", "in"],
  ["deploying", "from"],
  ["reviewing", "in"],
  ["testing", "in"],
  ["profiling", "in"],
  ["rebasing", "in"],
  ["prototyping", "in"],
  ["bisecting", "in"],
  ["typechecking", "in"],
  ["benchmarking", "in"],
  ["merging", "in"],
  ["migrating", "in"],
  ["hacking", "in"],
  ["sketching", "in"],
  ["pushing", "from"],
  ["linting", "in"],
  ["demoing", "in"],
];

/**
 * The spinner's nth line, such as "shipping in SoMa": the verbs and the
 * neighborhoods each cycle on their own, so the pairs keep changing.
 */
export function phraseAt(n: number): string {
  const index = Math.max(0, Math.floor(n));
  const [verb, preposition] = WORK[index % WORK.length] ?? ["shipping", "in"];
  const place = NEIGHBORHOODS[index % NEIGHBORHOODS.length] ?? NEIGHBORHOODS[0];
  return `${verb} ${preposition} ${place?.inSentence ?? "SoMa"}`;
}

/** Venues the community has met at, by street address (brand/foundations.md). */
const VENUES: readonly (readonly [address: string, neighborhood: string])[] = [
  ["201 spear st", "East Cut"],
  ["100 1st st", "East Cut"],
  ["45 fremont st", "FiDi"],
  ["351 california st", "FiDi"],
  ["50 beale st", "FiDi"],
  ["525 market st", "FiDi"],
  ["585 market st", "FiDi"],
  ["660 market st", "FiDi"],
  ["1 post st", "FiDi"],
  ["40 o'farrell st", "Union Square"],
  ["760 market st", "Union Square"],
  ["444 de haro st", "Potrero Hill"],
  ["277 carolina st", "Potrero Hill"],
  ["pier 70", "Dogpatch"],
  ["1242 market st", "Mid-Market"],
  ["360 ritch st", "SoMa"],
  ["620 treat ave", "Mission"],
  ["500 terry a francois blvd", "Mission Bay"],
];

/** Otherwise the neighborhood a ZIP code mostly covers, by its local name. */
const ZIPS: Readonly<Record<string, string>> = {
  "94102": "Mid-Market",
  "94103": "SoMa",
  "94104": "FiDi",
  "94105": "East Cut",
  "94107": "SoMa",
  "94108": "Union Square",
  "94109": "Nob Hill",
  "94110": "Mission",
  "94111": "FiDi",
  "94112": "Excelsior",
  "94114": "Castro",
  "94115": "Western Addition",
  "94116": "Parkside",
  "94117": "Haight",
  "94118": "Inner Richmond",
  "94121": "Outer Richmond",
  "94122": "Inner Sunset",
  "94123": "Marina",
  "94124": "Bayview",
  "94127": "West Portal",
  "94129": "Presidio",
  "94130": "Treasure Island",
  "94131": "Noe Valley",
  "94132": "Lakeshore",
  "94133": "North Beach",
  "94134": "Visitacion Valley",
  "94158": "Mission Bay",
};

/**
 * The neighborhood of a venue's address: a venue the community knows by its
 * street address, else the ZIP code's, else null (left out, never guessed).
 */
export function neighborhoodOf(address: string | null): string | null {
  if (address === null) return null;
  const plain = address
    .toLowerCase()
    .replaceAll("’", "'")
    .replaceAll(/\bstreet\b/g, "st")
    .replaceAll(/\s+/g, " ");
  // Words, so "45 fremont st" is found in "sentry, 45 fremont st, ..." and
  // never inside "145 fremont st".
  const words = ` ${plain.replaceAll(/[^a-z0-9']+/g, " ").trim()} `;
  for (const [street, neighborhood] of VENUES) {
    if (words.includes(` ${street} `)) return neighborhood;
  }
  if (!/san francisco|\bsf\b/.test(plain)) return null;
  const zip = /\b(94\d{3})\b/.exec(plain)?.[1];
  return zip === undefined ? null : (ZIPS[zip] ?? null);
}

/** Where a turn's walk starts: a number from its id, so each turn sets out somewhere else. */
export function seedOf(turnId: string): number {
  let hash = 0;
  for (const char of turnId)
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 9_973;
  return hash;
}
