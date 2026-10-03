import { looksLikeImage } from "@/lib/event-covers/image-signature";
import { readBodyAtMost } from "@/lib/event-covers/read-body";
import { processImage } from "@/lib/image-processor";
import { fetchFromHosts } from "./fetch-allowed";

const maxImageBytes = 15 * 1024 * 1024;

export type StoredImage = {
  bytes: Uint8Array;
  width: number;
  height: number;
  format: string;
  placeholder: string;
};

/**
 * Downloads an image from an allowed host: every redirect is checked, the
 * size is capped while streaming, and the bytes must be a real image.
 */
export async function downloadImage(
  url: string,
  hosts: ReadonlySet<string>,
  { signal }: { signal: AbortSignal },
): Promise<Uint8Array> {
  const response = await fetchFromHosts(url, hosts, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Image download failed: ${response.status}`);
  }
  const bytes = await readBodyAtMost(response, maxImageBytes);
  if (!looksLikeImage(bytes)) {
    throw new Error("Not a PNG, JPEG, GIF, WebP or AVIF image");
  }
  return bytes;
}

export async function processForStorage(
  bytes: Uint8Array,
): Promise<StoredImage> {
  const processed = await processImage(bytes);
  return {
    bytes: processed.buffer,
    width: processed.metadata.width,
    height: processed.metadata.height,
    format: processed.metadata.format,
    placeholder: processed.placeholder,
  };
}
