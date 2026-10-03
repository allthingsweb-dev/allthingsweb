import { describe, expect, test } from "bun:test";
import { looksLikeImage } from "../src/lib/event-covers/image-signature";

const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(
    parts.flatMap((part) =>
      typeof part === "string" ? [...part].map((c) => c.charCodeAt(0)) : part,
    ),
  );

describe("recognizing cover images by their bytes", () => {
  test.each([
    ["PNG", bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], [0])],
    ["JPEG", bytes([0xff, 0xd8, 0xff, 0xe0])],
    ["GIF", bytes("GIF89a")],
    ["WebP", bytes("RIFF", [0, 0, 0, 0], "WEBPVP8 ")],
    ["AVIF", bytes([0, 0, 0, 0x1c], "ftypavif")],
  ])("accepts %s", (_name, image) => {
    expect(looksLikeImage(image)).toBe(true);
  });

  test.each([
    ["HTML", bytes("<!doctype html>")],
    ["a form body", bytes("a=1&b=2")],
    ["RIFF audio", bytes("RIFF", [0, 0, 0, 0], "WAVEfmt ")],
    ["an MP4 video", bytes([0, 0, 0, 0x1c], "ftypisom")],
    ["nothing", bytes()],
  ])("rejects %s", (_name, data) => {
    expect(looksLikeImage(data)).toBe(false);
  });
});
