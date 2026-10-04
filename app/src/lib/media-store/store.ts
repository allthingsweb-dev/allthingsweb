export type MediaStoreConfig = {
  /** Where stored objects are publicly served, e.g. https://media.allthings.dev */
  publicUrl: string;
  /** The upload Worker that writes to the bucket. */
  uploadUrl: string | undefined;
  uploadToken: string | undefined;
};

export type MediaStore = {
  /** Stores the object and returns its public URL. */
  put: (
    key: string,
    body: Uint8Array,
    contentType: string,
    options?: { signal?: AbortSignal },
  ) => Promise<string>;
  remove: (key: string, options?: { signal?: AbortSignal }) => Promise<void>;
  /** The key of a stored object's URL, or null for any other URL. */
  keyOf: (url: string) => string | null;
};

const encodeKey = (key: string) =>
  key.split("/").map(encodeURIComponent).join("/");

const trimSlashes = (url: string) => url.replace(/\/+$/, "");

/** Stores media through the upload Worker; objects are served from publicUrl. */
export function mediaStore(
  config: MediaStoreConfig,
  fetchImpl: typeof fetch = fetch,
): MediaStore {
  // Configured URLs may end with "/"; every join below adds exactly one.
  const publicUrl = trimSlashes(config.publicUrl);
  const uploadUrl = config.uploadUrl && trimSlashes(config.uploadUrl);
  const send = async (
    method: "PUT" | "DELETE",
    key: string,
    init: { body?: Uint8Array; contentType?: string; signal?: AbortSignal },
  ) => {
    if (!uploadUrl || !config.uploadToken) {
      throw new Error(
        "Media uploads need MEDIA_UPLOAD_URL and MEDIA_UPLOAD_TOKEN",
      );
    }
    const response = await fetchImpl(`${uploadUrl}/${encodeKey(key)}`, {
      method,
      headers: {
        authorization: `Bearer ${config.uploadToken}`,
        ...(init.contentType ? { "content-type": init.contentType } : {}),
      },
      // fetch takes ArrayBuffer-backed bytes; a Node Buffer may not be.
      ...(init.body ? { body: new Uint8Array(init.body) } : {}),
      ...(init.signal ? { signal: init.signal } : {}),
    });
    if (!response.ok) {
      throw new Error(`Media ${method} ${key} failed: ${response.status}`);
    }
  };

  return {
    put: async (key, body, contentType, options = {}) => {
      await send("PUT", key, { body, contentType, ...options });
      return `${publicUrl}/${encodeKey(key)}`;
    },
    remove: (key, options = {}) => send("DELETE", key, options),
    keyOf: (url) => {
      if (!url.startsWith(`${publicUrl}/`)) return null;
      try {
        return decodeURIComponent(url.slice(publicUrl.length + 1)) || null;
      } catch {
        return null;
      }
    },
  };
}

/**
 * A name reduced to a key-safe slug: letters (with their marks) and digits in
 * any script, joined by dashes, so "Erik Peña" stays "erik-peña".
 */
export function keySlug(name: string, fallback: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return slug || fallback;
}
