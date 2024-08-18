import type { MetaFunction } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { getEvents } from "~/modules/pocketbase/pocketbase.server";

export const meta: MetaFunction = () => {
  return [
    { title: "All Things Web" },
    { name: "description", content: "Bay Area events, hackathons, & more!" },
  ];
};

export async function loader() {
  const events = await getEvents();
  const latestEvent = events[0];
  return redirect(`/${latestEvent.slug}`);
}
