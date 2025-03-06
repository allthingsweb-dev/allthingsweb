import { notFound } from "~/modules/responses.server";
import { Route } from "./+types/$slug_.data";

export { headers } from "~/modules/header.server";

export async function loader({ params, context }: Route.LoaderArgs) {
  const { slug } = params;
  if (typeof slug !== "string") {
    throw notFound();
  }
  const event = await context.queryClient.getExpandedEventBySlug(slug);
  if (!event) {
    throw notFound();
  }
  return Response.json({ event });
}

