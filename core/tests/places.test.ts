import { describe, expect, test } from "bun:test";
import { neighborhoodOf, places } from "../src/places.ts";

/** brand/foundations.md's "Places" table: venues, then their neighborhood. */
async function foundationsPlaces(): Promise<Array<[string, Array<string>]>> {
  const markdown = await Bun.file(
    new URL("../../brand/foundations.md", import.meta.url),
  ).text();
  const section = markdown.split("## Places")[1]?.split("\n## ")[0] ?? "";
  return section
    .split("\n")
    .filter((line) => line.startsWith("| ") && !line.startsWith("| Venue"))
    .filter((line) => !line.startsWith("| ---"))
    .map((line) => {
      const [venues = "", neighborhood = ""] = line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim());
      const addresses = venues
        .replace(/\s*\([^)]*\)/g, "")
        .split(",")
        .map((address) => address.trim());
      return [neighborhood, addresses];
    });
}

describe("places", () => {
  test("are brand/foundations.md's Places table, row for row", async () => {
    expect(
      places.map((place) => [place.neighborhood, [...place.addresses]]),
    ).toEqual(await foundationsPlaces());
  });

  // How the venues of past evenings are stored.
  test.each([
    [
      "CodeRabbit, 201 Spear St 12th floor, San Francisco, CA 94105, USA",
      "East Cut",
    ],
    ["100 1st St #2400", "East Cut"],
    ["Sentry, 45 Fremont St, San Francisco, CA 94105, USA", "FiDi"],
    ["Mintlify, 1 Post St Ste 3000, San Francisco, CA 94104, USA", "FiDi"],
    [
      "Convene 100 Stockton, 40 O'Farrell St, San Francisco, CA 94108, USA",
      "Union Square",
    ],
    ["40 O’Farrell St", "Union Square"],
    [
      "Vapi Inc., 760 Market St Floor 11, San Francisco, CA 94102, USA",
      "Union Square",
    ],
    ["444 De Haro St #218", "Potrero Hill"],
    [
      "Standard Deviant Brewing Pier 70, 1070 Maryland St suite 195, San Francisco, CA 94107, USA",
      "Dogpatch",
    ],
    ["1242 Market St, San Francisco, CA 94102, USA", "Mid-Market"],
    ["360 Ritch Street", "SoMa"],
    ["620 Treat Ave", "Mission"],
    ["500 Terry A Francois Blvd", "Mission Bay"],
  ])("%s is in %s", (address, neighborhood) => {
    expect(neighborhoodOf([address])).toBe(neighborhood);
  });

  test.each([
    // A whole address only: these share digits or a street with a venue.
    "201 Post St",
    "11 Post St",
    "4500 Fremont St",
    "1 Market St, San Francisco, CA 94105",
    "Pier 700",
    "",
  ])("%j is no known venue", (address) => {
    expect(neighborhoodOf([address])).toBeNull();
  });

  test("the first address that names a venue decides", () => {
    expect(neighborhoodOf([null, "Somewhere else", "201 Spear St"])).toBe(
      "East Cut",
    );
    expect(neighborhoodOf(["620 Treat Ave", "201 Spear St"])).toBe("Mission");
    expect(neighborhoodOf([null, null])).toBeNull();
    expect(neighborhoodOf([])).toBeNull();
  });
});
