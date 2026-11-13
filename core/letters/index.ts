import december2026 from "./2026-12.ts";

/**
 * Every issue of the letter, one file each, named for its month
 * (2026-12.ts) and written to src/letter.ts's `Issue`. A new issue is a
 * new file and a line here: tests/letter.test.ts fails on a file in this
 * folder that isn't listed, and src/letter.ts decodes each at import.
 *
 * Listed here is not published: an issue is a draft until approvals.json
 * holds Erik's y for exactly what it says.
 */
export const issueFiles: ReadonlyArray<unknown> = [december2026];
