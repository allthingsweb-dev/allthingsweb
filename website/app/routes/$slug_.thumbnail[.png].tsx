import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { getFont } from "~/modules/image-gen/utils.server";
import { EventYouTubeThumbnail } from "~/modules/image-gen/templates";
import { notFound } from "~/modules/responses.server";
import { Route } from "./+types/$slug_.thumbnail[.png]";

export { headers } from "~/modules/header.server";

export async function loader({ params, context }: Route.LoaderArgs) {
  const { time, timeSync, getHeaderField } = context.serverTimingsProfiler;
  const { slug } = params;
  if (typeof slug !== "string") {
    throw notFound();
  }
  const event = await time("getExpandedEventBySlug", () =>
    context.queryClient.getExpandedEventBySlug(slug),
  );
  if (!event) {
    throw notFound();
  }

  const jsx = <EventYouTubeThumbnail event={event} />;

  const svg = await time("satori", async () =>
    satori(jsx, {
      width: 1280,
      height: 720,
      fonts: await getFont("Roboto"),
    }),
  );
  const resvg = new Resvg(svg);
  const pngData = timeSync("resvg.render", () => resvg.render());
  const data = timeSync("asPng", () => pngData.asPng());
  return new Response(data, {
    headers: {
      "Content-Type": "image/png",
      "Server-Timing": getHeaderField(),
    },
  });
}
