import { getImgResponse } from "openimg/node";
import { Route } from "./+types/img";

export { headers } from "~/modules/header.server";

export async function loader({ request, context }: Route.LoaderArgs) {
  const headers = new Headers();
  headers.set("cache-control", "public, max-age=172800");
  return getImgResponse(request, {
    cacheFolder: "no_cache",
    headers,
    allowlistedOrigins: [context.mainConfig.origin, context.mainConfig.s3.url],
  });
}
