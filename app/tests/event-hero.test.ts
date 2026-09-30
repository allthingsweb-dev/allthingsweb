import { expect, test } from "bun:test";
import { getEventHeroImage } from "../src/lib/event-hero";
const cover = {
  url: "/cover.png",
  alt: "Event poster",
  width: 800,
  height: 400,
};
const photo = { url: "/photo.png", alt: "People building together" };
test("uses the event cover, retaining its description and dimensions", () => {
  expect(
    getEventHeroImage({
      previewImage: cover,
      images: [photo],
      isHackathon: false,
    }),
  ).toEqual(cover);
});
test("uses an event photo when the cover is absent or the loader's generic placeholder", () => {
  for (const previewImage of [
    null,
    { url: "/hero-image-rocket.png", alt: "Fallback" },
  ]) {
    expect(
      getEventHeroImage({ previewImage, images: [photo], isHackathon: false }),
    ).toEqual(photo);
  }
});
test("retains distinct meetup and hackathon fallbacks without inventing event media", () => {
  expect(
    getEventHeroImage({ previewImage: null, images: [], isHackathon: false })
      .url,
  ).toBe("/hero-image-meetup.png");
  expect(
    getEventHeroImage({ previewImage: null, images: [], isHackathon: true })
      .url,
  ).toBe("/hero-image-hackathon.png");
});
