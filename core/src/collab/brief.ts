import { Schema } from "effect";
import { type BriefSection, Role } from "./model.ts";

/**
 * A brief, written as Markdown, cut into the sections `planning.brief_sections`
 * stores (`bun run collab brief set <slug> --from brief.md`). Each section is
 * a `## ` heading, then a line saying who it is for, then its body:
 *
 *     # allthings/trivia            (a title, optional, not stored)
 *
 *     ## The pitch
 *     <!-- for: viewer, commenter, round_host, venue -->
 *     A trivia night for …
 *
 *     ## Venues
 *     <!-- for: organizer -->
 *     …
 *
 * Who a section is for is never assumed: a section without its line is
 * refused, so nothing reaches a collaborator by default. Organizers see
 * every section whatever it says. `###` and deeper stay in the body, as
 * does anything inside a code fence. A `---` rule at a section's end is
 * dropped: in the file it separates sections, and the page draws its own.
 */

export const maxSections = 50;
const maxHeading = 120;
const maxBody = 20000;

const isRole = Schema.is(Role);

/** The sections `markdown` holds, or why it can't be stored. */
export function parseBrief(
  markdown: string,
): ReadonlyArray<BriefSection> | string {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const sections: Array<{
    heading: string;
    lines: Array<string>;
    line: number;
  }> = [];
  let fence: string | undefined;
  for (const [index, line] of lines.entries()) {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker !== undefined) {
      if (fence === undefined) fence = marker[0];
      else if (marker[0] === fence) fence = undefined;
    }
    const heading = fence === undefined ? /^## (.*)$/.exec(line) : null;
    if (heading !== null) {
      sections.push({
        heading: (heading[1] ?? "").trim(),
        lines: [],
        line: index + 1,
      });
      continue;
    }
    const current = sections.at(-1);
    if (current !== undefined) {
      current.lines.push(line);
    } else if (
      line.trim() !== "" &&
      !line.startsWith("# ") &&
      line.trim() !== "---"
    ) {
      return `Line ${index + 1} comes before the first "## " section. Put it in a section, so it says who it is for.`;
    }
  }
  if (sections.length === 0) return 'The brief has no "## " sections.';
  if (sections.length > maxSections) {
    return `The brief has ${sections.length} sections; at most ${maxSections}.`;
  }

  const parsed: Array<BriefSection> = [];
  for (const [index, section] of sections.entries()) {
    const where = `Section "${section.heading}" (line ${section.line})`;
    if (section.heading === "") return `${where} has no heading.`;
    if (section.heading.length > maxHeading) {
      return `${where}: its heading is over ${maxHeading} characters.`;
    }
    const first = section.lines.findIndex((line) => line.trim() !== "");
    const audience =
      first === -1
        ? null
        : /^\s*<!--\s*for:\s*([^>]*?)\s*-->\s*$/.exec(
            section.lines[first] ?? "",
          );
    if (audience === null) {
      return `${where} doesn't say who it is for. Its first line must be <!-- for: … --> with roles from ${Role.literals.join(", ")}.`;
    }
    const named = (audience[1] ?? "")
      .split(",")
      .map((role) => role.trim())
      .filter((role) => role !== "");
    const unknown = named.filter((role) => !isRole(role));
    if (named.length === 0 || unknown.length > 0) {
      return `${where} is for ${unknown.length > 0 ? `"${unknown.join(", ")}", which isn't a role` : "no one"}. Roles: ${Role.literals.join(", ")}.`;
    }
    const audiences = Role.literals.filter((role) => named.includes(role));
    const body = section.lines.slice(first + 1);
    while (
      body.length > 0 &&
      ["", "---"].includes((body.at(-1) ?? "").trim())
    ) {
      body.pop();
    }
    while (body.length > 0 && (body[0] ?? "").trim() === "") body.shift();
    const text = body.join("\n");
    if (text.trim() === "") return `${where} has nothing in it.`;
    if (text.length > maxBody) {
      return `${where} is ${text.length} characters; at most ${maxBody}.`;
    }
    parsed.push({
      position: index + 1,
      heading: section.heading,
      body: text,
      audiences,
    });
  }
  const headings = parsed.map((section) => section.heading.toLowerCase());
  const repeated = headings.find(
    (heading, index) => headings.indexOf(heading) !== index,
  );
  if (repeated !== undefined) {
    return `Two sections are headed "${repeated}": give each its own heading, so a comment names one.`;
  }
  return parsed;
}
