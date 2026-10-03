const maxRedirects = 3;

/** Parses a URL, rejecting anything but HTTPS on one of the given hosts. */
export function allowedUrl(raw: string, hosts: ReadonlySet<string>): URL {
  const url = new URL(raw);
  if (url.protocol !== "https:" || !hosts.has(url.hostname)) {
    throw new Error(`URL is not on an allowed host: ${url.origin}`);
  }
  return url;
}

/**
 * Fetches a URL on an allowed host, checking every redirect against the same
 * hosts before any request is made to it.
 */
export async function fetchFromHosts(
  raw: string,
  hosts: ReadonlySet<string>,
  init: Omit<RequestInit, "redirect">,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  let url = allowedUrl(raw, hosts);
  for (let redirects = 0; ; redirects++) {
    const response = await fetchImpl(url, { ...init, redirect: "manual" });
    if (response.status < 300 || response.status >= 400) return response;
    await response.body?.cancel();
    const location = response.headers.get("location");
    if (!location) throw new Error("Redirect has no location");
    if (redirects === maxRedirects) {
      throw new Error("Redirected too many times");
    }
    url = allowedUrl(new URL(location, url).href, hosts);
  }
}
