/**
 * How a response is compressed for its client, on its own: the Worker's
 * store (page-store.ts) picks each visitor's coding before the app is
 * loaded, so this module imports nothing.
 */

/**
 * Each coding in an Accept-Encoding header with its weight (RFC 9110,
 * 12.5.3): `q` is read as a number, case-insensitively, and a coding
 * without a readable one weighs 1.
 */
function weights(acceptEncoding: string): Map<string, number> {
  const byCoding = new Map<string, number>();
  for (const part of acceptEncoding.split(",")) {
    const [coding = "", ...parameters] = part
      .split(";")
      .map((piece) => piece.trim());
    if (coding === "") continue;
    const q = parameters
      .map((parameter) => /^q\s*=\s*([0-9.]+)$/i.exec(parameter)?.[1])
      .find((value) => value !== undefined);
    const weight = q === undefined ? Number.NaN : Number(q);
    byCoding.set(coding.toLowerCase(), Number.isNaN(weight) ? 1 : weight);
  }
  return byCoding;
}

/**
 * The coding to send to a client that accepts `acceptEncoding`: Brotli,
 * else gzip, else `identity` (the HTML as is), or `undefined` when the
 * client refuses all three. A coding the client weighs 0 is refused, and
 * `*` stands for any coding it doesn't name. Identity is acceptable unless
 * refused that way (RFC 9110, 12.5.3), so a client that sends no
 * Accept-Encoding gets the HTML as is. Setting Content-Encoding is how a
 * Worker asks the runtime to compress a body.
 */
export function contentEncoding(
  acceptEncoding: string | undefined,
): "br" | "gzip" | "identity" | undefined {
  const accepted = weights(acceptEncoding ?? "");
  const wildcard = accepted.get("*");
  const weight = (coding: string) => accepted.get(coding) ?? wildcard;
  if ((weight("br") ?? 0) > 0) return "br";
  if ((weight("gzip") ?? 0) > 0) return "gzip";
  if ((weight("identity") ?? 1) > 0) return "identity";
  return undefined;
}
