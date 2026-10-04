import { describe, expect, test } from "bun:test";
import {
  findLumaCoverUrl,
  publicLumaCoverUrl,
} from "../src/lib/event-covers/luma-cover";

const options = { signal: new AbortController().signal };
const cover = "https://images.lumacdn.com/event-covers/jk/cover.jpg";

describe("finding a Luma event's cover", () => {
  test("uses the official API when it answers", async () => {
    let usedPublic = false;
    const url = await findLumaCoverUrl("evt-ours", options, {
      api: async () => cover,
      publicData: async () => {
        usedPublic = true;
        return null;
      },
    });
    expect(url).toBe(cover);
    expect(usedPublic).toBe(false);
  });

  test("falls back to public event data when the API refuses another calendar's event", async () => {
    const url = await findLumaCoverUrl("evt-theirs", options, {
      api: async () => {
        throw new Error("Failed to fetch event. Status: 403 - Forbidden");
      },
      publicData: async (id) => (id === "evt-theirs" ? cover : null),
    });
    expect(url).toBe(cover);
  });

  test("reports both failures when neither source answers", async () => {
    await expect(
      findLumaCoverUrl("evt-gone", options, {
        api: async () => {
          throw new Error("Status: 403");
        },
        publicData: async () => {
          throw new Error("Luma public event 404");
        },
      }),
    ).rejects.toThrow(
      "Luma API: Status: 403; public event data: Luma public event 404",
    );
  });
});

describe("Luma's public event data", () => {
  const respond = (body: unknown, status = 200) =>
    (async (input: string | URL | Request) => {
      expect(input instanceof Request ? input.url : String(input)).toBe(
        "https://api.lu.ma/event/get?event_api_id=evt-TpDFOGNSBwCxU72",
      );
      return new Response(JSON.stringify(body), { status });
    }) as typeof fetch;

  test("reads the event's cover", async () => {
    expect(
      await publicLumaCoverUrl(
        "evt-TpDFOGNSBwCxU72",
        options,
        respond({ event: { cover_url: cover, name: "After party" } }),
      ),
    ).toBe(cover);
  });

  test("returns null for an event without a cover", async () => {
    expect(
      await publicLumaCoverUrl(
        "evt-TpDFOGNSBwCxU72",
        options,
        respond({ event: { cover_url: null } }),
      ),
    ).toBeNull();
  });

  test("throws on an error status or an unexpected shape", async () => {
    await expect(
      publicLumaCoverUrl("evt-TpDFOGNSBwCxU72", options, respond({}, 404)),
    ).rejects.toThrow("404");
    await expect(
      publicLumaCoverUrl("evt-TpDFOGNSBwCxU72", options, respond({ nope: 1 })),
    ).rejects.toThrow();
  });
});
