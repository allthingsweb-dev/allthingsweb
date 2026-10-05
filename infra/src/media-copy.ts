/**
 * Copies every object of one R2 bucket into another, for moving
 * media.allthings.dev's bucket between Cloudflare accounts (run by
 * scripts/copy-media.ts). It never overwrites or deletes anything: a key the
 * target already has is either the same object, skipped so a rerun carries on
 * where the last one stopped, or a conflict it reports and leaves alone.
 *
 * Every copy is checked three times: the bytes read must hash to the source's
 * ETag, R2 refuses the upload unless they match the Content-MD5 sent with
 * them, and the ETag R2 answers with must be that MD5. `verify` then reads
 * both buckets (and, optionally, the public origin) and compares SHA-256s.
 */
import { AwsClient } from "aws4fetch";

/** An object as a listing shows it. */
export interface Listed {
  readonly key: string;
  readonly size: number;
  /** Lowercase hex, unquoted: the MD5 of the bytes unless it has a "-N" part count. */
  readonly etag: string;
}

/** An object's bytes and the headers it is served with. */
export interface Stored {
  readonly bytes: Uint8Array;
  readonly etag: string;
  /** Content-Type, Cache-Control and the like, and x-amz-meta-* (lowercase names). */
  readonly headers: Readonly<Record<string, string>>;
}

/** The operations a copy needs from a bucket. */
export interface Bucket {
  /** Bucket name and account, for messages. */
  readonly label: string;
  list(): AsyncIterable<Listed>;
  /** The object, or undefined if there is none at `key`. */
  get(key: string): Promise<Stored | undefined>;
  /**
   * Stores `bytes` at `key` only if nothing is there yet, refused unless they
   * match `md5` (base64). The new ETag, or undefined if the key was taken.
   */
  putNew(
    key: string,
    bytes: Uint8Array,
    md5: string,
    headers: Readonly<Record<string, string>>,
  ): Promise<string | undefined>;
}

/** The headers an object keeps when copied. */
export const KEPT_HEADERS = [
  "content-type",
  "cache-control",
  "content-disposition",
  "content-encoding",
  "content-language",
  "expires",
] as const;

export const keptHeaders = (
  headers: Headers | Readonly<Record<string, string>>,
): Record<string, string> => {
  const entries =
    headers instanceof Headers
      ? [...headers.entries()]
      : Object.entries(headers);
  const kept: Record<string, string> = {};
  for (const [name, value] of entries) {
    const lower = name.toLowerCase();
    if (
      (KEPT_HEADERS as ReadonlyArray<string>).includes(lower) ||
      lower.startsWith("x-amz-meta-")
    ) {
      kept[lower] = value;
    }
  }
  return kept;
};

/** An ETag as a lowercase, unquoted string. */
export const normalizeEtag = (etag: string): string =>
  etag.replace(/^W\//, "").replaceAll('"', "").toLowerCase();

/** Whether an ETag is an object's MD5 (not a multipart upload's). */
export const isMd5 = (etag: string): boolean => /^[0-9a-f]{32}$/.test(etag);

export const md5Hex = (bytes: Uint8Array): string =>
  new Bun.CryptoHasher("md5").update(bytes).digest("hex");

export const sha256Hex = (bytes: Uint8Array): string =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

const base64FromHex = (hex: string): string =>
  Buffer.from(hex, "hex").toString("base64");

/** What a source object needs, judged from both listings alone. */
export type Need =
  | "copy" // the target lacks it
  | "same" // the target has it, same size and MD5
  | "compare" // the target has it, but an ETag isn't an MD5: read both
  | "conflict"; // the target has something else at that key

export interface Plan {
  readonly needs: ReadonlyArray<{
    readonly object: Listed;
    readonly need: Need;
  }>;
  /** Keys only the target has, such as uploads made after a cutover. */
  readonly extra: ReadonlyArray<string>;
}

export const plan = (
  source: ReadonlyArray<Listed>,
  target: ReadonlyArray<Listed>,
): Plan => {
  const there = new Map(target.map((object) => [object.key, object]));
  const needs = source.map((object) => {
    const existing = there.get(object.key);
    const need: Need =
      existing === undefined
        ? "copy"
        : existing.size !== object.size
          ? "conflict"
          : isMd5(existing.etag) && isMd5(object.etag)
            ? existing.etag === object.etag
              ? "same"
              : "conflict"
            : "compare";
    return { object, need };
  });
  const keys = new Set(source.map((object) => object.key));
  const extra = target
    .map((object) => object.key)
    .filter((key) => !keys.has(key));
  return { needs, extra };
};

/** One object's outcome. */
export type Outcome =
  | {
      readonly key: string;
      readonly result: "copied";
      readonly size: number;
      readonly md5: string;
      readonly sha256: string;
    }
  | { readonly key: string; readonly result: "same" }
  | {
      readonly key: string;
      readonly result: "conflict" | "failed";
      readonly reason: string;
    };

/** Copies one object the plan says the target lacks. */
export const copyOne = async (
  source: Bucket,
  target: Bucket,
  object: Listed,
): Promise<Outcome> => {
  const read = await source.get(object.key);
  if (read === undefined) {
    return {
      key: object.key,
      result: "failed",
      reason: "gone from the source",
    };
  }
  const md5 = md5Hex(read.bytes);
  if (read.bytes.byteLength !== object.size) {
    return {
      key: object.key,
      result: "failed",
      reason: `read ${read.bytes.byteLength} bytes, listed ${object.size}`,
    };
  }
  if (isMd5(normalizeEtag(read.etag)) && normalizeEtag(read.etag) !== md5) {
    return {
      key: object.key,
      result: "failed",
      reason: `read bytes hash to ${md5}, the source's ETag is ${normalizeEtag(read.etag)}`,
    };
  }
  const etag = await target.putNew(
    object.key,
    read.bytes,
    base64FromHex(md5),
    keptHeaders(read.headers),
  );
  if (etag === undefined) {
    // Stored since the listing: the same object if it compares equal.
    return compareOne(source, target, object.key);
  }
  if (normalizeEtag(etag) !== md5) {
    return {
      key: object.key,
      result: "failed",
      reason: `stored with ETag ${normalizeEtag(etag)}, not ${md5}`,
    };
  }
  return {
    key: object.key,
    result: "copied",
    size: object.size,
    md5,
    sha256: sha256Hex(read.bytes),
  };
};

/** Reads an object from both buckets: the same bytes and headers, or a conflict. */
export const compareOne = async (
  source: Bucket,
  target: Bucket,
  key: string,
): Promise<Outcome> => {
  const [a, b] = await Promise.all([source.get(key), target.get(key)]);
  if (a === undefined)
    return { key, result: "failed", reason: "gone from the source" };
  if (b === undefined)
    return { key, result: "failed", reason: "missing from the target" };
  const difference = differs(a, b);
  return difference === undefined
    ? { key, result: "same" }
    : { key, result: "conflict", reason: difference };
};

/** How two copies of an object differ, if they do. */
export const differs = (a: Stored, b: Stored): string | undefined => {
  if (a.bytes.byteLength !== b.bytes.byteLength) {
    return `${a.bytes.byteLength} bytes against ${b.bytes.byteLength}`;
  }
  const [hashA, hashB] = [sha256Hex(a.bytes), sha256Hex(b.bytes)];
  if (hashA !== hashB) return `SHA-256 ${hashA} against ${hashB}`;
  const [kept, other] = [keptHeaders(a.headers), keptHeaders(b.headers)];
  for (const name of new Set([...Object.keys(kept), ...Object.keys(other)])) {
    if (kept[name] !== other[name]) {
      return `${name} ${JSON.stringify(kept[name])} against ${JSON.stringify(other[name])}`;
    }
  }
  return undefined;
};

/** Runs `work` over `items`, at most `limit` at a time, in order of completion. */
export async function* pooled<T, R>(
  items: ReadonlyArray<T>,
  limit: number,
  work: (item: T) => Promise<R>,
): AsyncGenerator<R> {
  const running = new Map<number, Promise<[number, R]>>();
  let next = 0;
  const start = () => {
    const index = next++;
    const item = items[index] as T;
    running.set(
      index,
      work(item).then((result) => [index, result] as [number, R]),
    );
  };
  while (next < items.length && running.size < limit) start();
  while (running.size > 0) {
    const [index, result] = await Promise.race(running.values());
    running.delete(index);
    if (next < items.length) start();
    yield result;
  }
}

/** S3 credentials for one bucket, from the environment only. */
export interface S3Bucket {
  readonly accountId: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

const decodeXml = (text: string): string =>
  text
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");

const element = (xml: string, name: string): string | undefined => {
  const match = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml);
  return match?.[1] === undefined ? undefined : decodeXml(match[1]);
};

/** One page of a ListObjectsV2 answer, asked for with encoding-type=url. */
export const parseListPage = (
  xml: string,
): { objects: Listed[]; next: string | undefined } => {
  const objects = [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map(
    ([, contents = ""]) => ({
      key: decodeURIComponent(element(contents, "Key") ?? ""),
      size: Number(element(contents, "Size")),
      etag: normalizeEtag(element(contents, "ETag") ?? ""),
    }),
  );
  const truncated = element(xml, "IsTruncated") === "true";
  return {
    objects,
    next: truncated ? element(xml, "NextContinuationToken") : undefined,
  };
};

const RETRIES = 4;

/** R2's S3 API for one bucket. Credentials never leave the signer. */
export const s3Bucket = (config: S3Bucket): Bucket => {
  const client = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: "s3",
    region: "auto",
    retries: RETRIES,
  });
  const base = `https://${config.accountId}.r2.cloudflarestorage.com/${encodeURIComponent(config.bucket)}`;
  const objectUrl = (key: string) =>
    `${base}/${key.split("/").map(encodeURIComponent).join("/")}`;
  const label = `${config.bucket} (account ${config.accountId})`;
  const fail = async (what: string, response: Response) =>
    new Error(
      `${what} in ${label}: ${response.status} ${(await response.text()).slice(0, 200)}`,
    );

  return {
    label,
    async *list() {
      let token: string | undefined;
      do {
        const url = new URL(base);
        url.searchParams.set("list-type", "2");
        url.searchParams.set("encoding-type", "url");
        url.searchParams.set("max-keys", "1000");
        if (token !== undefined)
          url.searchParams.set("continuation-token", token);
        const response = await client.fetch(url);
        if (!response.ok) throw await fail("Listing", response);
        const page = parseListPage(await response.text());
        yield* page.objects;
        token = page.next;
      } while (token !== undefined);
    },
    async get(key) {
      // Bytes exactly as stored: never decoded on the way.
      const response = await client.fetch(objectUrl(key), {
        headers: { "accept-encoding": "identity" },
      });
      if (response.status === 404) return undefined;
      if (!response.ok) throw await fail(`Reading ${key}`, response);
      return {
        bytes: new Uint8Array(await response.arrayBuffer()),
        etag: normalizeEtag(response.headers.get("etag") ?? ""),
        headers: keptHeaders(response.headers),
      };
    },
    async putNew(key, bytes, md5, headers) {
      const response = await client.fetch(objectUrl(key), {
        method: "PUT",
        body: bytes,
        headers: { ...headers, "content-md5": md5, "if-none-match": "*" },
      });
      if (response.status === 412) return undefined;
      if (!response.ok) throw await fail(`Storing ${key}`, response);
      return normalizeEtag(response.headers.get("etag") ?? "");
    },
  };
};

/** The public origin's copy of each object, for checking what visitors get. */
export const publicOrigin = (
  origin: string,
): Pick<Bucket, "get" | "label"> => ({
  label: origin,
  async get(key) {
    const response = await fetch(
      `${origin}/${key.split("/").map(encodeURIComponent).join("/")}`,
      { headers: { "accept-encoding": "identity" } },
    );
    if (response.status === 404) return undefined;
    if (!response.ok) {
      throw new Error(`Reading ${key} from ${origin}: ${response.status}`);
    }
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      etag: normalizeEtag(response.headers.get("etag") ?? ""),
      headers: keptHeaders(response.headers),
    };
  },
});
