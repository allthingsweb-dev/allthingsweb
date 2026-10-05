import { describe, expect, test } from "bun:test";
import sharp from "sharp";
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
