/**
 * Reading a cover and naming its file, for scripts/meetup-cover.ts; kept
 * apart from the command so tests can import them without running it.
 */

/**
 * A response's body, read chunk by chunk and abandoned as soon as it
 * passes `limit` bytes, whatever its content-length said.
 */
export async function readAtMost(
  response: Response,
  limit: number,
  label: string,
): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (reader === undefined) return new Uint8Array();
  const chunks: Array<Uint8Array> = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new Error(`${label} is over ${limit} bytes`);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

const plain = /^[A-Za-z0-9-]$/;

/**
 * A file name for `slug` in ASCII, one per slug: file systems store "é"
 * differently, so every byte of its UTF-8 but a letter, digit or "-" is
 * written as "_" and two hex digits ("café" → "caf_c3_a9"). "_" itself is
 * always escaped, so no two slugs share a name.
 */
export function fileSlug(slug: string): string {
  return [...new TextEncoder().encode(slug.normalize("NFC"))]
    .map((byte) => {
      const char = String.fromCharCode(byte);
      return plain.test(char) ? char : `_${byte.toString(16).padStart(2, "0")}`;
    })
    .join("");
}
