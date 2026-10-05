import { describe, expect, test } from "bun:test";
import sharp from "sharp";
import { encode } from "../scripts/encode.ts";

/** The re-encoder the script uses (scripts/encode.ts), on images Sharp draws. */

const png = (width: number, height: number, alpha: number) =>
  sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 200, g: 80, b: 40, alpha },
    },
  })
    .png()
    .toBuffer()
    .then((buffer) => new Uint8Array(buffer));

describe("encode", () => {
  test("makes an opaque photo a JPEG fitted inside the edge", async () => {
    const made = await encode(await png(5712, 4284, 1), 4096);
    expect(made.format).toBe("jpeg");
    expect([made.width, made.height]).toEqual([4096, 3072]);
    const metadata = await sharp(made.bytes).metadata();
    expect([metadata.format, metadata.width, metadata.height]).toEqual([
      "jpeg",
      4096,
      3072,
    ]);
  });

  test("never enlarges a smaller one", async () => {
    const made = await encode(await png(1200, 800, 1), 4096);
    expect([made.width, made.height]).toEqual([1200, 800]);
  });

  test("keeps a see-through image see-through, as WebP", async () => {
    const made = await encode(await png(800, 800, 0.5), 4096);
    expect(made.format).toBe("webp");
    expect((await sharp(made.bytes).metadata()).hasAlpha).toBe(true);
  });
});
