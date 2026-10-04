/**
 * The neighborhoods of San Francisco our evenings happen in, by venue
 * address: brand/foundations.md's "Places" table as data (a test holds the
 * two together). Every event names its neighborhood the way locals do, and
 * it is derived from the venue's address, never typed per event.
 *
 * A new venue gets a row here and in the foundations; until then its events
 * name no neighborhood rather than a wrong one.
 */

export interface Place {
  /** The name locals use, as it is printed: "FiDi", "East Cut". */
  readonly neighborhood: string;
  /** Street addresses (or landmarks, such as "Pier 70") in it. */
  readonly addresses: ReadonlyArray<string>;
}

/** In the order of the foundations' table. */
export const places: ReadonlyArray<Place> = [
  { neighborhood: "East Cut", addresses: ["201 Spear St", "100 1st St"] },
  {
    neighborhood: "FiDi",
    addresses: [
      "45 Fremont St",
      "351 California St",
      "50 Beale St",
      "525 Market St",
      "585 Market St",
      "660 Market St",
      "1 Post St",
    ],
  },
  {
    neighborhood: "Union Square",
    addresses: ["40 O'Farrell St", "760 Market St"],
  },
  {
    neighborhood: "Potrero Hill",
    addresses: ["444 De Haro St", "277 Carolina St"],
  },
  { neighborhood: "Dogpatch", addresses: ["Pier 70"] },
  { neighborhood: "Mid-Market", addresses: ["1242 Market St"] },
  { neighborhood: "SoMa", addresses: ["360 Ritch St"] },
  { neighborhood: "Mission", addresses: ["620 Treat Ave"] },
  { neighborhood: "Mission Bay", addresses: ["500 Terry A Francois Blvd"] },
];

const suffixes: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bstreet\b/g, "st"],
  [/\bavenue\b/g, "ave"],
  [/\bboulevard\b/g, "blvd"],
];

/** Lowercase, one space, typographic apostrophes plain, street types short. */
function normalize(address: string): string {
  let text = address
    .toLowerCase()
    .replaceAll("’", "'")
    .replace(/\s+/g, " ")
    .trim();
  for (const [long, short] of suffixes) text = text.replace(long, short);
  return text;
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const matchers = places.flatMap((place) =>
  place.addresses.map((address) => ({
    neighborhood: place.neighborhood,
    // A whole address only: "1 Post St" is not in "201 Post St".
    pattern: new RegExp(
      `(?:^|[^a-z0-9'])${escape(normalize(address))}(?![a-z0-9])`,
    ),
  })),
);

/**
 * The neighborhood of the first of `addresses` (street address, full
 * address, venue name, as stored) that names a known venue, or null.
 */
export function neighborhoodOf(
  addresses: ReadonlyArray<string | null>,
): string | null {
  for (const address of addresses) {
    if (address === null) continue;
    const text = normalize(address);
    const match = matchers.find(({ pattern }) => pattern.test(text));
    if (match !== undefined) return match.neighborhood;
  }
  return null;
}
