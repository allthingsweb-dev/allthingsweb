import { describe, expect, test } from "bun:test";
import {
  defaultTagline,
  eventTagline,
  isPlaceholderTagline,
} from "../src/tagline.ts";

/** An evening in one line: the organizers' tagline, else Luma's summary. */

describe("a placeholder tagline", () => {
  test("is blank or the sync's", () => {
    for (const tagline of ["", "  ", defaultTagline, ` ${defaultTagline} `]) {
      expect(isPlaceholderTagline(tagline)).toBe(true);
    }
  });

  test("is never anyone's words", () => {
    for (const tagline of [
      "Join us for the first All Things Web event of 2025!",
      "See Luma for details",
      "Typed errors, on a rooftop",
      "Come build with us at All Things Web",
    ]) {
      expect(isPlaceholderTagline(tagline)).toBe(false);
    }
  });
});

describe("an evening's tagline", () => {
  test("is the organizers', or Luma's summary while theirs is a placeholder", () => {
    expect(eventTagline({ tagline: " Ours ", lumaSummary: "Luma's." })).toBe(
      "Ours",
    );
    expect(
      eventTagline({ tagline: defaultTagline, lumaSummary: " Luma's. " }),
    ).toBe("Luma's.");
    expect(eventTagline({ tagline: defaultTagline, lumaSummary: null })).toBe(
      "",
    );
  });
});
