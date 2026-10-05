import { describe, expect, test } from "bun:test";
import {
  formats,
  isKey,
  parseVariant,
  sourceOf,
  squares,
  type Variant,
  variantPath,
  widths,
} from "../src/images/variants.ts";

/** Image variants' URLs: the one URL each variant has, and nothing else. */

const photo = (url: string, version = "1767323045") => ({
  url,
  alt: "",
  width: 1600,
  height: 1200,
  version,
});

describe("variant URLs", () => {
  const sizes = [
    ...widths.map((width) => ({ kind: "width", width }) as const),
    ...squares.map((side) => ({ kind: "square", side }) as const),
  ];

  test("name the size, format, version and key, and read back as the same variant", () => {
    for (const size of sizes) {
      for (const format of Object.keys(formats) as Array<
        keyof typeof formats
      >) {
        const variant: Variant = {
          size,
          format,
          version: "1767323045",
          key: "events/0a92acea/cover-7dbdc6e7.png",
        };
        expect(parseVariant(variantPath(variant))).toEqual(variant);
      }
    }
    expect(
      variantPath({
        size: { kind: "width", width: 480 },
        format: "avif",
        version: "1",
        key: "profiles/erik-peña.png",
      }),
    ).toBe("/img/480/avif/1/profiles/erik-pe%C3%B1a.png");
    expect(
      variantPath({
        size: { kind: "square", side: 72 },
        format: "jpeg",
        version: "1",
        key: "a.jpg",
      }),
    ).toBe("/img/72x72/jpeg/1/a.jpg");
  });

  test.each([
    // Sizes, formats and versions that don't exist.
    "/img/500/webp/1/events/a.jpg",
    "/img/36/webp/1/events/a.jpg",
    "/img/0480/webp/1/events/a.jpg",
    "/img/480x480/webp/1/events/a.jpg",
    "/img/36x72/webp/1/events/a.jpg",
    "/img/480/png/1/events/a.jpg",
    "/img/480/WEBP/1/events/a.jpg",
    "/img/480/toString/1/events/a.jpg",
    "/img/480/webp/v1/events/a.jpg",
    "/img/480/webp/1234567890123/events/a.jpg",
    "/img/480/webp//events/a.jpg",
    // No key, or not a key.
    "/img/480/webp/1",
    "/img/480/webp/1/",
    "/img/480/webp/1/events/",
    "/img/480/webp/1/.hidden.jpg",
    "/img/480/webp/1/events/../a.jpg",
    "/img/480/webp/1/events/%2e%2e/a.jpg",
    "/img/480/webp/1/events/..%2fa.jpg",
    "/img/480/webp/1/events/a..b.jpg",
    "/img/480/webp/1/events//a.jpg",
    "/img/480/webp/1/https:/elsewhere.example/a.jpg",
    "/img/480/webp/1/events/a%20b.jpg",
    "/img/480/webp/1/events/a.svg",
    "/img/480/webp/1/events/a.html",
    "/img/480/webp/1/events/a",
    `/img/480/webp/1/${"a".repeat(600)}.jpg`,
    // Malformed escapes.
    "/img/480/webp/1/events/%E0%A4%A.jpg",
    // Other spellings of a variant that exists.
    "/img/480/webp/1/events%2Fa.jpg",
    "/img/480/webp/1/events/%61.jpg",
    "/img/480/webp/1/events/a.jpg/",
    "/img//480/webp/1/events/a.jpg",
    "/IMG/480/webp/1/events/a.jpg",
    "img/480/webp/1/events/a.jpg",
  ])("refuse %s", (path) => {
    expect(parseVariant(path)).toBeUndefined();
  });

  test("accept keys in any script, as the app writes them", () => {
    expect(isKey("profiles/erik-peña-1f2e.jpeg")).toBe(true);
    expect(isKey("events/2024-10-05-hackathon/preview_1.PNG")).toBe(true);
    expect(isKey("events/a b.jpg")).toBe(false);
    expect(isKey("events/a.jpg?x")).toBe(false);
  });
});

describe("a photo's source", () => {
  test("is its key on the media origin, decoded, with its version", () => {
    expect(
      sourceOf(
        photo("https://media.allthings.dev/profiles/erik-pe%C3%B1a.png"),
      ),
    ).toEqual({ key: "profiles/erik-peña.png", version: "1767323045" });
  });

  test.each([
    ["on another origin", photo("https://elsewhere.example/a.jpg")],
    [
      "on a lookalike origin",
      photo("https://media.allthings.dev.example/a.jpg"),
    ],
    [
      "not an image the binding reads",
      photo("https://media.allthings.dev/a.svg"),
    ],
    ["badly escaped", photo("https://media.allthings.dev/a%E0.jpg")],
    ["with a dot segment", photo("https://media.allthings.dev/x/../a.jpg")],
    [
      "without a usable version",
      photo("https://media.allthings.dev/a.jpg", ""),
    ],
  ])("is none for a photo %s", (_, value) => {
    expect(sourceOf(value)).toBeUndefined();
  });
});
