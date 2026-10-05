import { describe, expect, test } from "bun:test";
import {
  type Bucket,
  compareOne,
  copyOne,
  type Listed,
  md5Hex,
  parseListPage,
  plan,
  pooled,
  sha256Hex,
  type Stored,
} from "../src/media-copy.ts";

const bytes = (text: string) => new TextEncoder().encode(text);

/** An R2 bucket in memory, with the S3 API's PUT checks. */
const memoryBucket = (
  label: string,
  objects: Record<
    string,
    { body: string; headers?: Record<string, string> }
  > = {},
) => {
  const store = new Map<string, Stored>(
    Object.entries(objects).map(([key, { body, headers = {} }]) => {
      const data = bytes(body);
      return [key, { bytes: data, etag: md5Hex(data), headers }];
    }),
  );
  const puts: string[] = [];
  const bucket: Bucket & { store: typeof store; puts: string[] } = {
    label,
    store,
    puts,
    async *list() {
      for (const [key, object] of [...store].toSorted(([a], [b]) =>
        a.localeCompare(b),
      )) {
        yield { key, size: object.bytes.byteLength, etag: object.etag };
      }
    },
    async get(key) {
      return store.get(key);
    },
    async putNew(key, data, md5, headers) {
      if (store.has(key)) return undefined;
      if (Buffer.from(md5Hex(data), "hex").toString("base64") !== md5) {
        throw new Error("BadDigest");
      }
      puts.push(key);
      store.set(key, {
        bytes: data,
        etag: md5Hex(data),
        headers: { ...headers },
      });
      return md5Hex(data);
    },
  };
  return bucket;
};

const listed = async (bucket: Bucket) => {
  const all: Listed[] = [];
  for await (const object of bucket.list()) all.push(object);
  return all;
};

/** Every object the plan says to copy, copied. */
const copyAll = async (source: Bucket, target: Bucket) => {
  const { needs } = plan(await listed(source), await listed(target));
  return Promise.all(
    needs
      .filter(({ need }) => need === "copy")
      .map(({ object }) => copyOne(source, target, object)),
  );
};

describe("plan", () => {
  const object = (key: string, body: string): Listed => ({
    key,
    size: bytes(body).byteLength,
    etag: md5Hex(bytes(body)),
  });

  test("copies what the target lacks and skips what it has", () => {
    const { needs, extra } = plan(
      [object("a.jpg", "a"), object("b.jpg", "b")],
      [object("b.jpg", "b"), object("new.jpg", "n")],
    );
    expect(needs.map((n) => [n.object.key, n.need])).toEqual([
      ["a.jpg", "copy"],
      ["b.jpg", "same"],
    ]);
    expect(extra).toEqual(["new.jpg"]);
  });

  test("calls something else at the same key a conflict", () => {
    const { needs } = plan(
      [object("a.jpg", "a"), object("b.jpg", "bb")],
      [object("a.jpg", "z"), object("b.jpg", "b")],
    );
    expect(needs.map(({ need }) => need)).toEqual(["conflict", "conflict"]);
  });

  test("reads both copies when an ETag is a multipart upload's", () => {
    const multipart = {
      ...object("a.jpg", "a"),
      etag: "0123456789abcdef0123456789abcdef-2",
    };
    expect(plan([multipart], [object("a.jpg", "a")]).needs[0]?.need).toBe(
      "compare",
    );
  });
});

describe("copyOne", () => {
  test("copies bytes and headers, and a rerun copies nothing", async () => {
    const source = memoryBucket("source", {
      "events/a.jpg": {
        body: "photo",
        headers: { "content-type": "image/jpeg", "x-amz-meta-by": "erik" },
      },
      "profiles/ada.png": {
        body: "portrait",
        headers: { "content-type": "image/png" },
      },
    });
    const target = memoryBucket("target");

    const first = await copyAll(source, target);
    expect(first.map((o) => o.result)).toEqual(["copied", "copied"]);
    expect(first[0]).toMatchObject({
      key: "events/a.jpg",
      md5: md5Hex(bytes("photo")),
      sha256: sha256Hex(bytes("photo")),
    });
    expect(target.store.get("events/a.jpg")?.headers).toEqual({
      "content-type": "image/jpeg",
      "x-amz-meta-by": "erik",
    });

    expect(await copyAll(source, target)).toEqual([]);
    expect(target.puts).toEqual(["events/a.jpg", "profiles/ada.png"]);
  });

  test("never writes bytes that don't hash to the source's ETag", async () => {
    const source = memoryBucket("source", { "a.jpg": { body: "photo" } });
    const stored = source.store.get("a.jpg");
    if (stored === undefined) throw new Error("missing fixture");
    // A read that went wrong on the way: the listing and ETag say "photo".
    source.store.set("a.jpg", { ...stored, bytes: bytes("phoTo") });
    const target = memoryBucket("target");

    const outcome = await copyOne(source, target, {
      key: "a.jpg",
      size: 5,
      etag: md5Hex(bytes("photo")),
    });
    expect(outcome).toMatchObject({ result: "failed" });
    expect(target.puts).toEqual([]);
  });

  test("leaves a key stored since the listing alone, and says if it differs", async () => {
    const source = memoryBucket("source", { "a.jpg": { body: "photo" } });
    const target = memoryBucket("target");
    const [object] = await listed(source);
    if (object === undefined) throw new Error("missing fixture");
    target.store.set("a.jpg", {
      bytes: bytes("other"),
      etag: md5Hex(bytes("other")),
      headers: {},
    });

    expect(await copyOne(source, target, object)).toMatchObject({
      result: "conflict",
    });
    expect(target.store.get("a.jpg")?.bytes).toEqual(bytes("other"));
  });
});

describe("compareOne", () => {
  test("is the same only with the same bytes and headers", async () => {
    const source = memoryBucket("source", {
      same: { body: "x", headers: { "content-type": "image/png" } },
      bytes: { body: "x" },
      header: { body: "x", headers: { "content-type": "image/png" } },
    });
    const target = memoryBucket("target", {
      same: { body: "x", headers: { "content-type": "image/png" } },
      bytes: { body: "y" },
      header: { body: "x", headers: { "content-type": "image/jpeg" } },
    });
    expect(await compareOne(source, target, "same")).toEqual({
      key: "same",
      result: "same",
    });
    expect(await compareOne(source, target, "bytes")).toMatchObject({
      result: "conflict",
    });
    expect(await compareOne(source, target, "header")).toMatchObject({
      result: "conflict",
      reason: 'content-type "image/png" against "image/jpeg"',
    });
    expect(await compareOne(source, target, "absent")).toMatchObject({
      result: "failed",
    });
  });
});

describe("parseListPage", () => {
  test("reads keys, sizes, ETags and the next page's token", () => {
    const page = parseListPage(`<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult><Name>allthings-media</Name><IsTruncated>true</IsTruncated>
<Contents><Key>profiles/erik-pe%C3%B1a.png</Key><Size>1234</Size><ETag>&quot;0CC175B9C0F1B6A831C399E269772661&quot;</ETag></Contents>
<Contents><Key>events/a%26b.jpg</Key><Size>5</Size><ETag>"abc-2"</ETag></Contents>
<NextContinuationToken>tok&amp;en</NextContinuationToken></ListBucketResult>`);
    expect(page).toEqual({
      objects: [
        {
          key: "profiles/erik-peña.png",
          size: 1234,
          etag: "0cc175b9c0f1b6a831c399e269772661",
        },
        { key: "events/a&b.jpg", size: 5, etag: "abc-2" },
      ],
      next: "tok&en",
    });
  });

  test("has no next page when the listing isn't truncated", () => {
    expect(
      parseListPage(
        "<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>",
      ),
    ).toEqual({ objects: [], next: undefined });
  });
});

describe("pooled", () => {
  test("runs at most the limit at once and yields every result", async () => {
    let running = 0;
    let most = 0;
    const results: number[] = [];
    for await (const result of pooled([1, 2, 3, 4, 5], 2, async (n) => {
      running++;
      most = Math.max(most, running);
      await Bun.sleep(5 - n);
      running--;
      return n * 10;
    })) {
      results.push(result);
    }
    expect(most).toBe(2);
    expect(results.toSorted((a, b) => a - b)).toEqual([10, 20, 30, 40, 50]);
  });
});
