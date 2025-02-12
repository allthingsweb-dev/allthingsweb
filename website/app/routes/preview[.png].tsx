import { Resvg } from "@resvg/resvg-js";
import satori from "satori";
import { LandingPagePreview } from "~/modules/image-gen/templates";
import { getFont } from "~/modules/image-gen/utils.server";
import { Route } from "./+types/preview[.png]";
import { getPastEventImages } from "~/modules/homepage/homepage";

export { headers } from "~/modules/header.server";

export async function loader({ context }: Route.LoaderArgs) {
  const { time, timeSync, getHeaderField } = context.serverTimingsProfiler;
  const pastEventImages = await getPastEventImages({
    db: context.db,
    s3Client: context.s3Client,
  });

  const jsx = <LandingPagePreview images={pastEventImages} />;
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
