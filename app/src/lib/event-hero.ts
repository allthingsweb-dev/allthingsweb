import type { Image } from "./events";

export function getEventHeroImage(event: {
  previewImage: Image | null;
  images: Image[];
  isHackathon: boolean;
}): Image {
  // The event loader supplies this generic preview when no cover is stored.
  if (
    event.previewImage &&
    event.previewImage.url !== "/hero-image-rocket.png"
  ) {
    return event.previewImage;
  }
  if (event.images.length > 0) return event.images[0];
  return {
    url: event.isHackathon
      ? "/hero-image-hackathon.png"
      : "/hero-image-meetup.png",
    alt: event.isHackathon
      ? "Illustration of developers celebrating at a hackathon"
      : "Illustration of developers chatting at a meetup",
    width: 1200,
    height: 1200,
  };
}
