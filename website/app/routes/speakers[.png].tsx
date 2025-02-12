import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { getFont } from "~/modules/image-gen/utils.server";
import { SpeakersPreview } from "~/modules/image-gen/templates";
import { Route } from "./+types/speakers[.png]";

export { headers } from "~/modules/header.server";

export async function loader({ context }: Route.LoaderArgs) {
  const { time, timeSync, getHeaderField } = context.serverTimingsProfiler;
  const speakers = await context.queryClient.getSpeakerProfiles();

  const jsx = <SpeakersPreview speakers={speakers} />;

  const svg = await time(
    "satori",
    satori(jsx, {
      width: 1200,
      height: 630,
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
