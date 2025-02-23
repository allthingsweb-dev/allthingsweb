import { getImgResponse } from "openimg/node";
import { Route } from "./+types/img";

export { headers } from "~/modules/header.server";

export async function loader({ request, context }: Route.LoaderArgs) {
  const headers = new Headers();
  headers.set("cache-control", "public, max-age=172800");
  return getImgResponse(request, {
    cacheFolder:
      context.mainConfig.environment === "production"
        ? "/data/images"
        : "./data/images",
    getImgSource: ({ request }) => {
      const src = new URL(request.url).searchParams.get("src");
      if(!src) {
        return new Response("src query parameter is required", { status: 400 });
      }
      if (URL.canParse(src)) {
        // Remote images
        return { type: "fetch", url: src };
      }
      if (src.includes("assets")) {
        // Vite assets
        return { type: "fs", path: "." + src };
      }
      // Public folder assets
      return { type: "fs", path: "./public" + src };
    },
    headers,
    allowlistedOrigins: [context.mainConfig.origin, context.mainConfig.s3.url],
  });
}
