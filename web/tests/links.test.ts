import { describe, expect, test } from "bun:test";
import { hosts, socials } from "../src/links.ts";

/** Who and where the footer names, held to brand/foundations.md. */

const foundations = await Bun.file(
  new URL("../../brand/foundations.md", import.meta.url),
).text();

describe("socials", () => {
  test("are the channels the foundations list, in their order", () => {
    const listed =
      /Socials sit in a quiet line of words in the footer \(([^)]+)\)/.exec(
        foundations,
      )?.[1];
    expect(listed).toBe(
      "luma · discord · youtube · github · x · bluesky · linkedin",
    );
    expect(socials.map((social) => social.name).join(" · ")).toBe(listed ?? "");
  });

  test("link over https", () => {
    for (const social of socials) {
      expect(new URL(social.href).protocol).toBe("https:");
    }
  });
});

describe("hosts", () => {
  test("are Erik and Andre, as the foundations sign off", () => {
    expect(foundations).toContain(
      `"hosted by ${hosts[0].name} & ${hosts[1].name}"`,
    );
  });

  test("name two different speaker profiles by their uuid", () => {
    for (const host of hosts) {
      expect(host.profileId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    }
    expect(hosts[0].profileId).not.toBe(hosts[1].profileId);
  });
});
