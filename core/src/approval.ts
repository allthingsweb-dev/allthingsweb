import { Effect } from "effect";

/**
 * Approval of exactly what goes out: whatever the event studio would put
 * on Luma or post to a platform is hashed, and only a token an organizer
 * read and approved for that very content lets it go (src/luma/publish.ts,
 * src/social/).
 */

/** `value` as JSON with every object's keys sorted: the same content, the same text. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .toSorted()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** The approval token for `content`: the first 16 hex digits of the SHA-256 of its canonical JSON. */
export const approvalToken = (content: unknown) =>
  Effect.promise(async () => {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(canonicalJson(content)),
    );
    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 16);
  });

/** An approval token, as an organizer passes it back. */
export const isApprovalToken = (token: string): boolean =>
  /^[0-9a-f]{16}$/.test(token);
