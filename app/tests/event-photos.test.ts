import { describe, expect, test } from "bun:test";
import { failureReason } from "../scripts/event-photos";

/**
 * The admin MCP server's photo tools (scripts/event-photos.ts) run core's
 * `bun run photos`, which core tests (tests/photos.test.ts). When a run
 * fails, the tool passes on the reason it logged, such as a refused
 * approval, not just the command line.
 */
describe("failureReason", () => {
  test("is the message of the error the tool logged", () => {
    expect(
      failureReason(
        [
          "[08:43:24.906] ERROR (#2): PhotosError: The removal has changed since 0000000000000000 was approved: it is now 0bf2e2e49de722f5. Read it again with --dry-run, and approve that.",
          "    at fail (/core/src/photos.ts:126:50)",
          "",
        ].join("\n"),
      ),
    ).toBe(
      "The removal has changed since 0000000000000000 was approved: it is now 0bf2e2e49de722f5. Read it again with --dry-run, and approve that.",
    );
    expect(
      failureReason(
        "[08:42:49.477] ERROR (#2): Error: Give --dry-run to read what would change, or --approve <token> to make exactly that change.\n",
      ),
    ).toBe(
      "Give --dry-run to read what would change, or --approve <token> to make exactly that change.",
    );
  });

  test("is whatever the tool printed when it logged no error, and nothing when it printed nothing", () => {
    expect(failureReason("\nerror: script not found\n")).toBe(
      "error: script not found",
    );
    expect(failureReason(" \n")).toBeUndefined();
  });
});
