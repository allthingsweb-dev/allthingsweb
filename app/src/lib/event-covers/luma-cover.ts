import { z } from "zod";

const publicEventSchema = z.object({
  event: z.object({ cover_url: z.string().nullish() }),
});

/**
 * The cover from Luma's public event data, which is what luma.com itself
 * shows. Our API key can only read events our calendar manages; events we
 * list from other calendars (partner after-parties, demo days) need this.
 */
export async function publicLumaCoverUrl(
  lumaEventId: string,
  { signal }: { signal: AbortSignal },
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const url = new URL("https://api.lu.ma/event/get");
  url.searchParams.set("event_api_id", lumaEventId);
  const response = await fetchImpl(url, { signal });
  if (!response.ok) {
    throw new Error(`Luma public event ${response.status}`);
  }
  const { event } = publicEventSchema.parse(await response.json());
  return event.cover_url || null;
}

/**
 * Asks the official API first and falls back to the public event data when
 * the API refuses, e.g. 403 for an event another calendar manages.
 */
export async function findLumaCoverUrl(
  lumaEventId: string,
  options: { signal: AbortSignal },
  sources: {
    api: (
      id: string,
      options: { signal: AbortSignal },
    ) => Promise<string | null>;
    publicData: typeof publicLumaCoverUrl;
  },
): Promise<string | null> {
  try {
    return await sources.api(lumaEventId, options);
  } catch (apiError) {
    try {
      return await sources.publicData(lumaEventId, options);
    } catch (publicError) {
      const reason = (error: unknown) =>
        error instanceof Error ? error.message : String(error);
      throw new Error(
        `Luma API: ${reason(apiError)}; public event data: ${reason(publicError)}`,
        { cause: publicError },
      );
    }
  }
}
