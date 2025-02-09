import { getMetaTags } from "../meta";
import { Route } from "../../routes/+types/$slug";

export const meta: Route.MetaFunction = ({ data, matches }) => {
  const rootMatch = matches.find((match) => match && match.id === "root");
  if (!rootMatch || !rootMatch.meta) {
    return [{ title: "Event not found" }];
  }
  if (!rootMatch.data) {
    return [{ title: "Event not found" }, ...rootMatch.meta];
  }
  const title = data.event.name;
  const description = data.event.tagline;
  const eventUrl = `${(rootMatch as Route.MetaArgs["matches"][0]).data.serverOrigin}/${data.event.slug}`;
  const previewImageUrl = data.event.previewImage?.url;
  return [
    ...getMetaTags(title, description, eventUrl, previewImageUrl),
    ...rootMatch.meta,
  ];
};
