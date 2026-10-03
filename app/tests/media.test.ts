import { describe, expect, test } from "bun:test";
import {
  mediaKeyFromSegments,
  serveMedia,
  toMediaUrl,
  type MediaDependencies,
} from "../src/lib/media";

const storage = "https://allthingsweb-dev.s3.us-west-2.amazonaws.com";
const key = "events/96eaa25d/bbd25fc5.png";

function deps(overrides: Partial<MediaDependencies> = {}): MediaDependencies {
  return {
    storageOrigin: storage,
    isKnownImage: async (url) => url === `${storage}/${key}`,
    getObject: async () => ({
      body: new Blob([new Uint8Array([137, 80, 78, 71])]).stream(),
      contentType: "image/png",
      contentLength: 4,
      etag: '"abc"',
    }),
    ...overrides,
  };
}

describe("stored image URLs", () => {
  test("map bucket URLs to stable media paths and leave others alone", () => {
    expect(toMediaUrl(`${storage}/${key}`, storage)).toBe(`/media/${key}`);
    expect(toMediaUrl("/hero-image-meetup.png", storage)).toBe(
      "/hero-image-meetup.png",
    );
    expect(toMediaUrl("https://images.lumacdn.com/x.png", storage)).toBe(
      "https://images.lumacdn.com/x.png",
    );
  });

  test("reject keys that could escape or smuggle paths", () => {
    expect(mediaKeyFromSegments(["events", "a.png"])).toBe("events/a.png");
    for (const segments of [
      [],
      [".."],
      ["events", "..", "secret"],
      [".env"],
      ["a b"],
      ["%2e%2e"],
    ]) {
      expect(mediaKeyFromSegments(segments)).toBeNull();
    }
  });
});

describe("serving media", () => {
  test("streams a known image with an immutable cache policy", async () => {
    const response = await serveMedia(key.split("/"), deps());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(response.headers.get("etag")).toBe('"abc"');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([137, 80, 78, 71]),
    );
  });

  test("never serves objects that no image record references", async () => {
    let fetched = false;
    const response = await serveMedia(
      ["private", "export.csv"],
      deps({
        getObject: async () => {
          fetched = true;
          return null;
        },
      }),
    );
    expect(response.status).toBe(404);
    expect(fetched).toBe(false);
  });

  test("answers 404 for invalid keys and missing objects", async () => {
    expect((await serveMedia(["..", "x"], deps())).status).toBe(404);
    expect(
      (await serveMedia(key.split("/"), deps({ getObject: async () => null })))
        .status,
    ).toBe(404);
  });
});
