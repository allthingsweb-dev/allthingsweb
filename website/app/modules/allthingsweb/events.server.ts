import { Image } from "./images";

export function getDefaultPreviewImage(
  eventName: string,
  eventSlug: string,
  serverOrigin: string,
): Image {
  return {
    url: `${serverOrigin}/img/gen/${eventSlug}/preview.png?w=1200&h=1200`,
    alt: `Preview image for ${eventName}`,
    placeholder: null,
  } satisfies Image;
}
