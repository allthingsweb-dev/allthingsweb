import { Resvg } from "@resvg/resvg-js";
import satori from "satori";
import { LandingPagePreview } from "~/modules/image-gen/templates";
import { getFont } from "~/modules/image-gen/utils.server";
import { Route } from "./+types/preview[.png]";
import { Image } from "~/modules/allthingsweb/images";

export { headers } from "~/modules/header.server";

export async function loader({ context }: Route.LoaderArgs) {
  const { time, timeSync, getHeaderField } = context.serverTimingsProfiler;
  const pastEvents = await time("getPastEvents", () =>
    context.queryClient.getPublishedPastEvents(),
  );
  const images: Image[] = [];

  // TODO - add images to the images array

  const jsx = <LandingPagePreview images={images} />;
  const svg = await time("satori", async () =>
    satori(jsx, {
      width: 1200,
      height: 1200,
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
