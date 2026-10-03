/**
 * Reads a response body, giving up as soon as it passes `maxBytes` so an
 * oversized image is never held in memory whole.
 */
export async function readBodyAtMost(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  const tooLarge = () =>
    new Error(`Cover is larger than ${maxBytes / 1024 / 1024} MB`);
  if (Number(response.headers.get("content-length")) > maxBytes) {
    await response.body?.cancel();
    throw tooLarge();
  }
  if (!response.body) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let length = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxBytes) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
