import { Event } from "~/modules/allthingsweb/events";
import cachified from "@epic-web/cachified";
import { lru } from "~/modules/cache";
import { Route } from "./+types/rss";

function generateRSS(events: Event[], origin: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
    <channel>
        <title>All Things Web Bay Area events</title>
        <description>Sup! Subscribe to stay up to date with our monthly events.</description>
        <link>${origin}</link>
        <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
        ${events
          .map(
            (event) => `<item>
            <title>${event.name}</title>
            <description>${event.tagline}</description>
            <link>${origin}/${event.slug}</link>
            <pubDate>${event.createdAt.toUTCString()}</pubDate>
        </item>`,
          )
          .join("\n")}
    </channel>
</rss>`;
}

export async function loader({ context }: Route.LoaderArgs) {
  const events = await context.queryClient.getPublishedEvents();
  const content = await cachified({
    key: "rss",
    cache: lru,
    ttl: 5 * 60 * 1000, // 5 minute
    getFreshValue: () => generateRSS(events, context.mainConfig.origin),
  });
  return new Response(content, {
    headers: {
      "content-type": "application/rss+xml",
    },
  });
}
