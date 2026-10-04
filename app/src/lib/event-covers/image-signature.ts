const startsWith = (
  bytes: Uint8Array,
  signature: readonly number[],
  offset = 0,
) => signature.every((byte, index) => bytes[offset + index] === byte);

const ascii = (text: string) =>
  text.split("").map((char) => char.charCodeAt(0));

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
    isAvif(bytes)
  );
}

/**
 * AVIF files start with an ISO-BMFF `ftyp` box: size, "ftyp", a major brand,
 * a minor version, then compatible brands. AVIF may be the major brand or
 * only a compatible one (e.g. major brand "mif1").
 */
function isAvif(bytes: Uint8Array): boolean {
  if (!startsWith(bytes, ascii("ftyp"), 4)) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const boxEnd = Math.min(view.getUint32(0), bytes.byteLength);
  const brandOffsets = [8];
  for (let offset = 16; offset + 4 <= boxEnd; offset += 4) {
    brandOffsets.push(offset);
  }
  return brandOffsets.some(
    (offset) =>
      startsWith(bytes, ascii("avif"), offset) ||
      startsWith(bytes, ascii("avis"), offset),
  );
}
