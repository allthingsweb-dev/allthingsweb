import { describe, expect, test } from "bun:test";
import {
  maxMediaBytes,
  mediaStore,
  type MediaStoreConfig,
  MediaTooLargeError,
} from "@/lib/media-store/store";

const config: MediaStoreConfig = {
  publicUrl: "https://media.example.dev",
  uploadUrl: "https://upload.example.workers.dev",
  uploadToken: "secret-token",
};

function recordingFetch(status: number) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: input instanceof Request ? input.url : String(input),
      init: init ?? {},
    });
    return new Response(null, { status });
  }) as typeof fetch;
  return { impl, calls };
}

describe("media store", () => {
  test("puts through the upload Worker and returns the public URL", async () => {
    const { impl, calls } = recordingFetch(201);
    const body = new Uint8Array([1, 2, 3]);
    const url = await mediaStore(config, impl).put(
      "profiles/erik-peña-1.jpg",
      body,
      "image/jpeg",
    );
    expect(url).toBe("https://media.example.dev/profiles/erik-pe%C3%B1a-1.jpg");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      "https://upload.example.workers.dev/profiles/erik-pe%C3%B1a-1.jpg",
    );
    expect(calls[0]?.init.method).toBe("PUT");
    expect(calls[0]?.init.headers).toEqual({
      authorization: "Bearer secret-token",
      "content-type": "image/jpeg",
    });
    expect(calls[0]?.init.body).toEqual(body);
  });

  test("removes through the upload Worker", async () => {
    const { impl, calls } = recordingFetch(204);
    await mediaStore(config, impl).remove("events/e1/a.png");
    expect(calls[0]?.url).toBe(
      "https://upload.example.workers.dev/events/e1/a.png",
    );
    expect(calls[0]?.init.method).toBe("DELETE");
  });

  test("fails on a non-2xx answer instead of returning a URL", async () => {
    const { impl } = recordingFetch(401);
    await expect(
      mediaStore(config, impl).put("a.png", new Uint8Array(), "image/png"),
    ).rejects.toThrow("Media PUT a.png failed: 401");
  });

  test("refuses an image over 20 MB, saying so, without sending it", async () => {
    const { impl, calls } = recordingFetch(201);
    const store = mediaStore(config, impl);
    const tooLarge = store.put(
      "events/e1/photo.png",
      new Uint8Array(maxMediaBytes + 1),
      "image/png",
    );
    await expect(tooLarge).rejects.toBeInstanceOf(MediaTooLargeError);
    await expect(tooLarge).rejects.toThrow(
      "events/e1/photo.png is 20.1 MB, over the 20 MB an image may be. Save it as a JPEG, or scale it down, and upload it again.",
    );
    expect(calls).toHaveLength(0);
    // 20 MB itself is stored.
    await store.put("a.jpg", new Uint8Array(maxMediaBytes), "image/jpeg");
    expect(calls).toHaveLength(1);
  });

  test("refuses to upload without the Worker's URL and token", async () => {
    const { impl, calls } = recordingFetch(201);
    const store = mediaStore({ ...config, uploadToken: undefined }, impl);
    await expect(store.remove("a.png")).rejects.toThrow("MEDIA_UPLOAD_TOKEN");
    expect(calls).toHaveLength(0);
  });

  test("joins configured URLs that end with a slash with a single slash", async () => {
    const { impl, calls } = recordingFetch(201);
    const store = mediaStore(
      {
        ...config,
        publicUrl: "https://media.example.dev/",
        uploadUrl: "https://upload.example.workers.dev//",
      },
      impl,
    );
    expect(await store.put("a.png", new Uint8Array(), "image/png")).toBe(
      "https://media.example.dev/a.png",
    );
    expect(calls[0]?.url).toBe("https://upload.example.workers.dev/a.png");
    expect(store.keyOf("https://media.example.dev/a.png")).toBe("a.png");
  });

  test("finds the key of URLs on the public origin only", () => {
    const store = mediaStore(config);
    expect(store.keyOf("https://media.example.dev/events/e1/a.png")).toBe(
      "events/e1/a.png",
    );
    expect(
      store.keyOf("https://media.example.dev/profiles/erik-pe%C3%B1a-1.jpg"),
    ).toBe("profiles/erik-peña-1.jpg");
    expect(store.keyOf("https://media.example.dev/")).toBeNull();
    expect(store.keyOf("https://media.example.dev/a%E0%A4%A")).toBeNull();
    expect(store.keyOf("https://images.lumacdn.com/a.png")).toBeNull();
    expect(store.keyOf("https://media.example.dev.evil.com/a.png")).toBeNull();
  });
});
