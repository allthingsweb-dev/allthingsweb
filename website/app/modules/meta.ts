import { MetaFunction } from "@remix-run/node";

type MatchesObject = Parameters<MetaFunction>[0]["matches"];

type MetaDescriptors = ReturnType<MetaFunction>;

export function mergeMetaTags(tags: MetaDescriptors, matches: MatchesObject): MetaDescriptors {
  const rootRoute = matches.find((match => match.id === "root"));
  const rootMeta = rootRoute?.meta ?? [];
  return [ ...rootMeta, ...tags];
}
