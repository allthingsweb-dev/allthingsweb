import { Image } from "./images";

export function getDefaultPreviewImage(
  eventName: string,
  eventSlug: string,
  serverOrigin: string,
): Image {
  return {
    url: `${serverOrigin}/img?src=${serverOrigin}/${eventSlug}/preview.png&w=1200&h=630&format=webp`,
    alt: `Preview image for ${eventName}`,
    placeholder: null,
    width: 1200,
    height: 630,
  } satisfies Image;
}
