import { DateTime } from "effect";

/**
 * A social post's URL, read into what identifies the post, whatever form it
 * was shared in (x.com or twitter.com, a handle or a DID on Bluesky, a
 * LinkedIn share link or feed URL). Pure: no network.
 */

export type PostRef =
  | { readonly platform: "x"; readonly statusId: string }
  | {
      readonly platform: "bluesky";
      /** A handle or a DID, as the URL names the author. */
      readonly actor: string;
      readonly rkey: string;
    }
  | {
      readonly platform: "linkedin";
      readonly kind: "activity" | "share" | "ugcPost";
      readonly id: string;
    };

const xHosts = new Set([
  "x.com",
  "www.x.com",
  "mobile.x.com",
  "twitter.com",
  "www.twitter.com",
  "mobile.twitter.com",
]);
const blueskyHosts = new Set(["bsky.app", "www.bsky.app"]);
const linkedinHosts = new Set(["linkedin.com", "www.linkedin.com"]);

/** The post `input` names, or null when it names none this reads. */
export function parsePostUrl(input: string): PostRef | null {
  const url = URL.parse(input.trim());
  if (url === null || (url.protocol !== "https:" && url.protocol !== "http:")) {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split("/").filter((part) => part !== "");

  if (xHosts.has(host)) {
    // /<handle>/status/<id>, /i/status/<id>, /i/web/status/<id>, plus
    // trailing /photo/1 and the like.
    const at = parts.indexOf("status");
    const id = at >= 1 ? parts[at + 1] : undefined;
    return id !== undefined && /^\d{1,20}$/.test(id)
      ? { platform: "x", statusId: id }
      : null;
  }

  if (blueskyHosts.has(host)) {
    const [profile, actor, post, rkey] = parts;
    return profile === "profile" &&
      post === "post" &&
      actor !== undefined &&
      /^(did:[a-z]+:[A-Za-z0-9._:%-]+|[A-Za-z0-9.-]+\.[A-Za-z]{2,})$/.test(
        actor,
      ) &&
      rkey !== undefined &&
      /^[A-Za-z0-9._:~-]{1,512}$/.test(rkey)
      ? { platform: "bluesky", actor: actor.toLowerCase(), rkey }
      : null;
  }

  if (linkedinHosts.has(host)) {
    // /feed/update/urn:li:activity:<id>/ and its share and ugcPost forms.
    const urn = decodeURIComponent(url.pathname).match(
      /urn:li:(activity|share|ugcPost):(\d{10,25})/,
    );
    if (urn !== null) {
      return {
        platform: "linkedin",
        kind: urn[1] as "activity" | "share" | "ugcPost",
        id: urn[2] ?? "",
      };
    }
    // /posts/<author>_<slug>-activity-<id>-<suffix>
    const share = url.pathname.match(/^\/posts\/[^/]*-activity-(\d{10,25})-/);
    return share !== null && share[1] !== undefined
      ? { platform: "linkedin", kind: "activity", id: share[1] }
      : null;
  }

  return null;
}

/**
 * The post's canonical URL, stored once per post. X and LinkedIn need no
 * lookup; Bluesky's names the author by DID, which never changes, so a
 * handle URL is canonical only once the DID is known.
 */
export function canonicalUrl(ref: PostRef, did?: string): string {
  if (ref.platform === "x") return `https://x.com/i/status/${ref.statusId}`;
  if (ref.platform === "bluesky") {
    return `https://bsky.app/profile/${did ?? ref.actor}/post/${ref.rkey}`;
  }
  return `https://www.linkedin.com/feed/update/urn:li:${ref.kind}:${ref.id}/`;
}

/**
 * When a LinkedIn post was published: its id's first 41 bits are the Unix
 * time in milliseconds.
 */
export function linkedinPostedAt(id: string): DateTime.Utc {
  return DateTime.makeUnsafe(Number(BigInt(id) >> 22n));
}
