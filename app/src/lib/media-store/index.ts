import { mainConfig } from "@/lib/config";
import { mediaStore } from "./store";

/** The app's media store: the R2 bucket behind media.allthings.dev. */
export function appMediaStore() {
  return mediaStore(mainConfig.media);
}

export { keySlug, type MediaStore } from "./store";

/** Deletes the stored object behind an image URL; other URLs are left alone. */
export async function removeStoredObject(url: string): Promise<void> {
  const media = appMediaStore();
  const key = media.keyOf(url);
  if (key) await media.remove(key);
}
