import { describe, expect, test } from "bun:test";
import { DateTime, Duration } from "effect";
import {
  formats,
  formatsDoc,
  offset,
  openSourceProjects,
  programs,
  rulesFor,
  rulesMissing,
} from "../src/formats.ts";
import { EventProgram } from "../src/rows.ts";

/** The formats (src/formats.ts): every program's, and the rules' reach. */

const at = (iso: string) => DateTime.makeUnsafe(iso);

describe("formats", () => {
  test("every program has one, under its own name, in the doc's order", () => {
    expect([...programs].toSorted()).toEqual(
      [...EventProgram.literals].toSorted(),
    );
    for (const program of programs) {
      expect(formats[program].program).toBe(program);
    }
  });

  test("each schedule runs in order, inside the evening it starts", () => {
    for (const program of programs) {
      const { schedule, duration } = formats[program];
      expect(schedule[0]?.at).toBe(0);
      const times = schedule.map((step) => step.at);
      expect(times).toEqual(times.toSorted((a, b) => a - b));
      expect(new Set(times).size).toBe(times.length);
      for (const time of times) {
        expect(time).toBeLessThan(Duration.toMinutes(duration));
      }
    }
  });

  test("a stage only where there is one; talks only where they're asked", () => {
    expect(programs.filter((p) => formats[p].stage !== null)).toEqual([
      "talks",
      "open-floor",
    ]);
    expect(programs.filter((p) => formats[p].talksRequired)).toEqual(["talks"]);
    expect(programs.filter((p) => formats[p].scheduleRequired)).toEqual([
      "hackathon",
    ]);
  });

  test("every hackathon asks for open source projects", () => {
    expect(formats.hackathon.rules).toContain(openSourceProjects);
    expect(openSourceProjects.text).toContain("open source");
    expect(openSourceProjects.text).toContain("public repository");
    expect(openSourceProjects.text).toContain("OSI-approved license");
  });

  test("a step's time reads as hours and minutes after doors", () => {
    expect([0, 45, 90, 450].map(offset)).toEqual([
      "+0:00",
      "+0:45",
      "+1:30",
      "+7:30",
    ]);
  });
});

describe("rulesFor", () => {
  const hackathon = (start: string, curation: "ours" | "shared" = "ours") =>
    rulesFor({ program: "hackathon", startDate: at(start), curation });

  test("a rule applies from its first day in San Francisco", () => {
    // 11:59 PM on October 5 in San Francisco, then midnight on the 6th.
    expect(hackathon("2026-10-06T06:59:00Z")).toEqual([]);
    expect(hackathon("2026-10-06T07:00:00Z")).toEqual([openSourceProjects]);
  });

  test("never to an evening we only share, or a program without rules", () => {
    expect(hackathon("2026-11-07T17:00:00Z", "shared")).toEqual([]);
    expect(
      rulesFor({
        program: "talks",
        startDate: at("2026-11-07T17:00:00Z"),
        curation: "ours",
      }),
    ).toEqual([]);
  });
});

describe("rulesMissing", () => {
  const rules = [openSourceProjects];

  test("a description carries a rule word for word, its markup, case and spacing aside", () => {
    for (const description of [
      `<p>${openSourceProjects.text}</p>`,
      `<ul><li>${openSourceProjects.text.toLowerCase()}</li></ul>`,
      `<p>${openSourceProjects.text.replace(": ", ":&nbsp;").replaceAll(" ", "\n ")}</p>`,
      `<p>${openSourceProjects.text.replace("OSI-approved", "<strong>OSI-approved</strong>")}</p>`,
    ]) {
      expect(rulesMissing(description, rules)).toEqual([]);
    }
  });

  test("a paraphrase or a part of it is not the rule", () => {
    for (const description of [
      "<p>Projects should be open source.</p>",
      `<p>${openSourceProjects.text.replace("OSI-approved ", "")}</p>`,
      "",
      "<p>&#99999999;</p>",
    ]) {
      expect(rulesMissing(description, rules)).toEqual(rules);
    }
  });
});

describe("docs/event-formats.md", () => {
  test("is what the module says, as `bun run formats:doc` writes it", async () => {
    const doc = await Bun.file(
      new URL("../../docs/event-formats.md", import.meta.url),
    ).text();
    expect(doc).toBe(formatsDoc());
    for (const program of programs) {
      expect(doc).toContain(`## ${formats[program].name}\n`);
    }
    expect(doc).toContain(openSourceProjects.text);
  });
});
