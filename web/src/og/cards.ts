import { built } from "../assets.ts";
import type { Image } from "../../scripts/build.ts";
import type { OgImage } from "../pages/metadata.tsx";

/**
 * The brand's link-preview cards for pages that don't change with data
 * (brand/marks/og.py), with what each shows in words.
 */

const card = (image: Image, alt: string): OgImage => ({
  // Every asset the build writes is under /assets/.
  src: image.src as `/${string}`,
  width: image.width,
  height: image.height,
  alt,
});

const { cards } = built.og;

const sentences =
  "Evenings for people who build software. In the neighborhoods of San Francisco.";

export const ogCards = {
  home: card(cards.home, `allthings/_ · ${sentences}`),
  events: card(cards.events, `every evening · allthings/_ · ${sentences}`),
  people: card(cards.people, `people · allthings/_ · ${sentences}`),
  talks: card(cards.talks, `every talk · allthings/_ · ${sentences}`),
  guide: card(
    cards.guide,
    "the guide · allthings/_ · Happenings worth the trip: three stars are worth a special journey, two a detour, one a stop.",
  ),
  year: card(cards.year, `the year in evenings · allthings/_ · ${sentences}`),
  about: card(cards.about, `about · allthings/_ · ${sentences}`),
  codeOfConduct: card(
    cards.codeOfConduct,
    "code of conduct · allthings/_ · How we treat each other at every evening, and how to report a concern.",
  ),
  privacy: card(
    cards.privacy,
    "privacy · allthings/_ · What this site keeps about you, and how to have it taken down.",
  ),
  coach: card(
    cards.coach,
    "coach · allthings/_ · What a good talk looks like on our stage, and how to check yours.",
  ),
  brand: card(
    cards.brand,
    "allthings/brand · The rules every page, cover and line of copy is checked against.",
  ),
  notFound: card(
    cards.notFound,
    "not found · allthings/_ · No evening lives at this address.",
  ),
} as const satisfies Record<string, OgImage>;
