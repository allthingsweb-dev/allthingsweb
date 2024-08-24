import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { LoaderFunctionArgs } from "@remix-run/node";
import { getFont } from "~/modules/image-gen/utils.server";
import EventPreview from "~/modules/image-gen/templates";
import { getEventWithSpeakersBySlug } from "~/modules/pocketbase/api.server";
import { env } from "~/modules/env.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { slug } = params;
  if (typeof slug !== "string") {
    throw new Response("Not Found", { status: 404 });
  }
  const event = await getEventWithSpeakersBySlug(slug);
  console.log(event);
  if (!event) {
    throw new Response("Not Found", { status: 404 });
  }

  const jsx = (
    <EventPreview
      event={event}
      serverOrigin={env.server.origin}
    />
  );

  const svg = await satori(jsx, {
    width: 1200,
    height: 1200,
    fonts: await getFont("Roboto"),
  });
  const resvg = new Resvg(svg);
  const pngData = resvg.render();
  const data = pngData.asPng();
  return new Response(data, {
    headers: {
      "Content-Type": "image/png",
    },
  });
}
