/**
 * Hosts Luma serves event covers from: its own CDN, and Unsplash for covers
 * picked from Luma's built-in photo search. Covers come from nowhere else.
 */
const coverHosts = new Set([
  "images.lumacdn.com",
  "cdn.lu.ma",
  "images.unsplash.com",
]);
const maxRedirects = 3;

/** Parses a cover URL, rejecting anything but HTTPS on a known cover host. */
export function coverUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== "https:" || !coverHosts.has(url.hostname)) {
    throw new Error(`Cover URL is not on an allowed host: ${url.origin}`);
  }
  return url;
}

/**
 * Fetches a cover, checking the URL and every redirect against the allowed
 * hosts before any request is made to it.
 */
export async function fetchCover(
  raw: string,
  init: Omit<RequestInit, "redirect">,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  let url = coverUrl(raw);
  for (let redirects = 0; ; redirects++) {
    const response = await fetchImpl(url, { ...init, redirect: "manual" });
    if (response.status < 300 || response.status >= 400) return response;
    await response.body?.cancel();
    const location = response.headers.get("location");
    if (!location) throw new Error("Cover redirect has no location");
    if (redirects === maxRedirects) {
      throw new Error("Cover redirected too many times");
    }
    url = coverUrl(new URL(location, url).href);
  }
}
