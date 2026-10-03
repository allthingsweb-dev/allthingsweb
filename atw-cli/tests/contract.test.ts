import { describe, expect, test } from "bun:test";
import { z } from "zod";
import * as server from "../../app/src/lib/public-api/schemas.ts";
import { eventNotFoundMessage } from "../../app/src/lib/public-api/errors.ts";
import { isEventNotFound } from "../src/client.ts";
import * as cli from "../src/schemas.ts";

/** Descriptions are documentation for agents; the shapes must match exactly. */
function shape(schema: unknown): unknown {
  const json = z.toJSONSchema(schema as z.ZodType);
  return JSON.parse(
    JSON.stringify(json, (key, value) =>
      key === "description" ? undefined : value,
    ),
  );
}

describe("public contract", () => {
  test.each([
    ["eventSummarySchema"],
    ["eventSchema"],
    ["speakerSchema"],
    ["communitySchema"],
  ] as const)("the CLI's %s matches the server's", (name) => {
    expect(shape(cli[name])).toEqual(shape(server[name]));
  });

  test("the CLI recognizes the server's event-not-found message", () => {
    expect(isEventNotFound(eventNotFoundMessage("no-such-event"))).toBe(true);
  });
});
