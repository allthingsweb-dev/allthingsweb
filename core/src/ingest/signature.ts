/**
 * The bytes check every downloaded image passes before it is processed, as
 * the app does (app/src/lib/event-covers/image-signature.ts): Luma's CDN
 * doesn't always label covers with an image content type, so the bytes
 * decide. Unlike the app's, it also lets HEIC and HEIF through: `Pictures`
 * stores them as JPEG.
 */
const startsWith = (
  bytes: Uint8Array,
  signature: readonly number[],
  offset = 0,
) => signature.every((byte, index) => bytes[offset + index] === byte);

const ascii = (text: string) =>
  text.split("").map((char) => char.charCodeAt(0));

/** ISO-BMFF brands of the image formats read: AVIF, then HEIC and HEIF. */
const imageBrands = [
  "avif",
  "avis",
  "heic",
  "heix",
  "heim",
  "heis",
  "hevc",
  "hevx",
  "hevm",
  "hevs",
  "mif1",
  "msf1",
].map(ascii);

/** Whether bytes begin like an image format we can process. */
export function looksLikeImage(bytes: Uint8Array): boolean {
  return (
    startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) || // PNG
    startsWith(bytes, [0xff, 0xd8, 0xff]) || // JPEG
    startsWith(bytes, ascii("GIF8")) ||
    (startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8)) ||
    hasImageBrand(bytes)
  );
}

/**
 * AVIF, HEIC and HEIF files start with an ISO-BMFF `ftyp` box: size,
 * "ftyp", a major brand, a minor version, then compatible brands. The
 * format's brand may be the major one or only a compatible one (e.g. major
 * brand "mif1").
 */
function hasImageBrand(bytes: Uint8Array): boolean {
  if (!startsWith(bytes, ascii("ftyp"), 4)) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const boxEnd = Math.min(view.getUint32(0), bytes.byteLength);
  const brandOffsets = [8];
  for (let offset = 16; offset + 4 <= boxEnd; offset += 4) {
    brandOffsets.push(offset);
  }
  return brandOffsets.some((offset) =>
    imageBrands.some((brand) => startsWith(bytes, brand, offset)),
  );
}
