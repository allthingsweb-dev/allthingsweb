import { allowedUrl, fetchFromHosts } from "@/lib/remote-images/fetch-allowed";

/**
 * Hosts Luma serves event covers from: its own CDN, and Unsplash for covers
 * picked from Luma's built-in photo search. Covers come from nowhere else.
 */
export const coverHosts: ReadonlySet<string> = new Set([
  "images.lumacdn.com",
  "cdn.lu.ma",
  "images.unsplash.com",
]);

/** Parses a cover URL, rejecting anything but HTTPS on a known cover host. */
export function coverUrl(raw: string): URL {
  return allowedUrl(raw, coverHosts);
}

/** Fetches a cover, checking the URL and every redirect against the hosts. */
export function fetchCover(
  raw: string,
  init: Omit<RequestInit, "redirect">,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  return fetchFromHosts(raw, coverHosts, init, fetchImpl);
}
