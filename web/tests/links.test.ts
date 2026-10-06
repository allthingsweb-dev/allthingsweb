import { describe, expect, test } from "bun:test";
import {
  eventPath,
  hosts,
  personAnchor,
  personPath,
  socials,
} from "../src/links.ts";

/** Who and where the footer names, held to brand/foundations.md, and the links within the site. */

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

describe("personAnchor", () => {
  test("is the profile's id after p-, and a plain token whatever the id", () => {
    expect(personAnchor("717803b9-074f-47b9-adb7-ff3f2e520eee")).toBe(
      "p-717803b9-074f-47b9-adb7-ff3f2e520eee",
    );
    expect(personAnchor('<a b="c">')).toBe("p-_3c_a_20_b_3d__22_c_22__3e_");
    expect(personAnchor("a b")).not.toBe(personAnchor("a_b"));
  });
});

describe("personPath", () => {
  test("is the person's page, their slug as one encoded segment", () => {
    expect(personPath("ada-lovelace")).toBe("/people/ada-lovelace");
    expect(personPath("a/b c")).toBe("/people/a%2Fb%20c");
  });
});

describe("eventPath", () => {
  test("is the slug, encoded, as one root-relative segment", () => {
    expect(eventPath("2025-12-02-café night")).toBe(
      "/2025-12-02-caf%C3%A9%20night",
    );
    expect(eventPath("a/b")).toBe("/a%2Fb");
  });
});
