import { describe, expect, test } from "bun:test";
import { fetchCover } from "../src/lib/event-covers/cover-source";

const cover = "https://images.lumacdn.com/uploads/gl/cover.png";

function fakeFetch(...responses: Response[]) {
  const requested: string[] = [];
  const impl = (async (input: string | URL | Request) => {
    requested.push(String(input));
    const response = responses.shift();
    if (!response) throw new Error("Unexpected request");
    return response;
  }) as typeof fetch;
  return { impl, requested };
}

const redirectTo = (location: string) =>
  new Response(null, { status: 302, headers: { location } });

describe("fetching an event cover", () => {
  test("fetches a cover from Luma's image host", async () => {
    const { impl, requested } = fakeFetch(new Response("png"));
    const response = await fetchCover(cover, {}, impl);
    expect(response.status).toBe(200);
    expect(requested).toEqual([cover]);
  });

  test.each([
    "http://images.lumacdn.com/uploads/gl/cover.png",
    "https://169.254.169.254/latest/meta-data/",
    "https://localhost/cover.png",
    "https://images.lumacdn.com.evil.example/cover.png",
    "file:///etc/passwd",
  ])("refuses %s without making a request", async (url) => {
    const { impl, requested } = fakeFetch();
    await expect(fetchCover(url, {}, impl)).rejects.toThrow();
    expect(requested).toEqual([]);
  });

  test("follows a redirect to another allowed host", async () => {
    const { impl, requested } = fakeFetch(
      redirectTo("https://cdn.lu.ma/cover.png"),
      new Response("png"),
    );
    expect((await fetchCover(cover, {}, impl)).status).toBe(200);
    expect(requested).toEqual([cover, "https://cdn.lu.ma/cover.png"]);
  });

  test("never requests a redirect target outside the allowed hosts", async () => {
    const { impl, requested } = fakeFetch(redirectTo("http://10.0.0.1/admin"));
    await expect(fetchCover(cover, {}, impl)).rejects.toThrow(
      "not on an allowed host",
    );
    expect(requested).toEqual([cover]);
  });

  test("gives up after a few redirects", async () => {
    const { impl } = fakeFetch(
      ...Array.from({ length: 5 }, () => redirectTo(cover)),
    );
    await expect(fetchCover(cover, {}, impl)).rejects.toThrow("too many times");
  });
});
