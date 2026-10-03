import { appMediaStore } from "@/lib/media-store";
import type { StoredImage } from "./download";

/** Stores and deletes ingested images in the app's media store. */
export function imageBucket() {
  const media = appMediaStore();
  return {
    store: (
      key: string,
      image: StoredImage,
      { signal }: { signal: AbortSignal },
    ): Promise<string> =>
      media.put(key, image.bytes, `image/${image.format}`, { signal }),
    // Runs even after cancellation, so it bounds itself.
    remove: (key: string): Promise<void> =>
      media.remove(key, { signal: AbortSignal.timeout(5_000) }),
  };
}
