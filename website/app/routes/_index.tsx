import type { MetaFunction } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { mergeMetaTags } from "~/modules/meta";
import { getEvents } from "~/modules/pocketbase/api.server";

export const meta: MetaFunction = ({ matches }) => {
  return mergeMetaTags(
    [
      { title: "All Things Web" },
      { name: "description", content: "Bay Area events, hackathons, & more!" },
    ],
    matches
  );
};

export async function loader() {
  const events = await getEvents();
  const latestEvent = events[0];
  return redirect(`/${latestEvent.slug}`);
}
