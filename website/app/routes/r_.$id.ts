import cachified from "@epic-web/cachified";
import { redirect } from "react-router";
import { lru } from "~/modules/cache";
import { notFound } from "~/modules/responses.server";
import { Route } from "./+types/r_.$id";

export async function loader({ params, context }: Route.LoaderArgs) {
  const id = params.id;
  if (!id) {
    throw new Error("No id provided");
  }
  const link = await cachified({
    key: `getLink-${id}`,
    ttl: 3 * 60 * 1000, // 3 minutes
    cache: lru,
    getFreshValue() {
      return context.queryClient.getRedirectLink(id);
    },
  });
  if (!link) {
    return notFound();
  }
  // Redirect to the destination URL (moved permanently for SEO authority)
  return redirect(link.destinationUrl, { status: 301 });
}
