import { mainConfig } from "@/lib/config";
import type { Image } from "@/lib/events";
import { toMediaUrl } from "@/lib/media";

// Callers still use the historical "sign" names; images are no longer
// presigned but served from stable /media URLs.
export async function signImage(image: Image): Promise<Image> {
  return { ...image, url: toMediaUrl(image.url, mainConfig.s3.url) };
}

export async function signImages(images: Image[]): Promise<Image[]> {
  return Promise.all(images.map(signImage));
}
