import { MetaFunction } from "@remix-run/node";
import { mergeMetaTags } from "../meta";
import { type loader } from "./loader.sever";

export const meta: MetaFunction<typeof loader> = ({ data, matches }) => {
  if (!data || !data.event) {
    return [{ title: "Event Not Found" }];
  }
  return mergeMetaTags(
    [
      { title: `${data.event.name} | All Things Web` },
      { name: "description", content: data.event.tagline },
    ],
    matches
  );
};
