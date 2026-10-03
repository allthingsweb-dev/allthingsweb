const startsWith = (
  bytes: Uint8Array,
  signature: readonly number[],
  offset = 0,
) => signature.every((byte, index) => bytes[offset + index] === byte);

const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));

/**
 * Whether bytes begin like an image format we can process. Luma's CDN does
 * not always label covers with an image content type, so the bytes decide.
 */
export function looksLikeImage(bytes: Uint8Array): boolean {
  return (
    startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) || // PNG
    startsWith(bytes, [0xff, 0xd8, 0xff]) || // JPEG
    startsWith(bytes, ascii("GIF8")) ||
    (startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8)) ||
    (startsWith(bytes, ascii("ftyp"), 4) &&
      (startsWith(bytes, ascii("avif"), 8) ||
        startsWith(bytes, ascii("avis"), 8)))
  );
}
