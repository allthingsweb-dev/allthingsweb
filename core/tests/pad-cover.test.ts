import { describe, expect, test } from "bun:test";
import sharp from "sharp";
import { fileSlug, readAtMost } from "../scripts/cover-file.ts";
import { padCover, wideFrame } from "../scripts/pad-cover.ts";

/** Meetup's cover padding (scripts/pad-cover.ts), on images Sharp draws. */

const orange = { r: 200, g: 80, b: 40 };

const png = (width: number, height: number, alpha = 1) =>
  sharp({
    create: { width, height, channels: 4, background: { ...orange, alpha } },
  })
    .png()
    .toBuffer()
    .then((buffer) => new Uint8Array(buffer));

/** The colour at (x, y) of a padded cover. */
const pixel = async (bytes: Uint8Array, x: number, y: number) => {
  const { data, info } = await sharp(bytes)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const at = (y * info.width + x) * info.channels;
  return [data[at] ?? -1, data[at + 1] ?? -1, data[at + 2] ?? -1];
};

/** Near enough, for JPEG. */
const near = (actual: ReadonlyArray<number>, expected: ReadonlyArray<number>) =>
  actual.every((value, index) => Math.abs(value - (expected[index] ?? 0)) <= 6);

describe("wideFrame", () => {
  test("is exactly 16:9 and holds the image whole", () => {
    for (const [width, height] of [
      [1000, 1000],
      [2000, 500],
      [1600, 900],
      [1, 1],
      [1081, 607],
    ] as const) {
      const frame = wideFrame(width, height);
      expect(frame.width * 9).toBe(frame.height * 16);
      expect(frame.width).toBeGreaterThanOrEqual(width);
      expect(frame.height).toBeGreaterThanOrEqual(height);
      // The smallest such frame: one step down no longer holds it.
      expect(frame.width - 16 < width || frame.height - 9 < height).toBe(true);
    }
  });

  test("leaves a 16:9 image as it is", () => {
    expect(wideFrame(1600, 900)).toEqual({ width: 1600, height: 900 });
  });
});

describe("padCover", () => {
  test("centers a square cover on black, uncut and unscaled", async () => {
    const padded = await padCover(await png(1000, 1000));
    expect([padded.width, padded.height]).toEqual([1792, 1008]);
    const metadata = await sharp(padded.bytes).metadata();
    expect([metadata.format, metadata.width, metadata.height]).toEqual([
      "jpeg",
      1792,
      1008,
    ]);
    expect(near(await pixel(padded.bytes, 10, 500), [0, 0, 0])).toBe(true);
    expect(near(await pixel(padded.bytes, 1781, 500), [0, 0, 0])).toBe(true);
    expect(
      near(await pixel(padded.bytes, 896, 504), [orange.r, orange.g, orange.b]),
    ).toBe(true);
  });

  test("pads a wide banner above and below", async () => {
    const padded = await padCover(await png(2000, 500));
    expect([padded.width, padded.height]).toEqual([2000, 1125]);
    expect(near(await pixel(padded.bytes, 1000, 20), [0, 0, 0])).toBe(true);
    expect(
      near(await pixel(padded.bytes, 1000, 562), [
        orange.r,
        orange.g,
        orange.b,
      ]),
    ).toBe(true);
  });

  test("turns see-through pixels black", async () => {
    const padded = await padCover(await png(900, 900, 0));
    expect(near(await pixel(padded.bytes, 800, 450), [0, 0, 0])).toBe(true);
  });

  test("turns a photo upright by its EXIF orientation first", async () => {
    // Stored 400 wide and 200 tall, shown rotated a quarter turn.
    const sideways = await sharp({
      create: { width: 400, height: 200, channels: 3, background: orange },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const padded = await padCover(new Uint8Array(sideways));
    expect([padded.width, padded.height]).toEqual([720, 405]);
  });
});

describe("readAtMost", () => {
  const streamOf = (sizes: ReadonlyArray<number>) =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (const size of sizes) controller.enqueue(new Uint8Array(size));
          controller.close();
        },
      }),
    );

  test("reads a body within the limit whole", async () => {
    const bytes = await readAtMost(streamOf([3, 4]), 7, "cover");
    expect(bytes.byteLength).toBe(7);
  });

  test("stops at the first chunk past the limit, whatever content-length said", async () => {
    let pulled = 0;
    const endless = new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          pulled += 1;
          controller.enqueue(new Uint8Array(1024));
        },
      }),
      { headers: { "content-length": "10" } },
    );
    await expect(readAtMost(endless, 4096, "cover")).rejects.toThrow(
      "cover is over 4096 bytes",
    );
    expect(pulled).toBeLessThan(10);
  });
});

describe("fileSlug", () => {
  test("keeps letters, digits and hyphens, and escapes the rest by byte", () => {
    expect(fileSlug("2025-12-02-café-night")).toBe(
      "2025-12-02-caf_c3_a9-night",
    );
    expect(fileSlug("a_b")).toBe("a_5fb");
  });

  test("gives different slugs different names", () => {
    const slugs = ["café-night", "cafe-night", "caf_c3_a9-night", "café-night"];
    // "e" + combining accent is the same slug as "é" once normalized.
    expect(new Set(slugs.map(fileSlug)).size).toBe(3);
    expect(fileSlug("café-night")).toBe(fileSlug("café-night"));
  });
});

describe("padCover limits", () => {
  test("refuses a cover that would pad past the frame limit", async () => {
    const strip = await png(20000, 1);
    await expect(padCover(strip)).rejects.toThrow(/over 80000000 pixels/);
  });
});
