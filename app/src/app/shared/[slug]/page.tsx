import { notFound, permanentRedirect } from "next/navigation";
import { db } from "@/lib/db";
import { longSlugForShortLink } from "@/lib/short-links";

/**
 * /shared/<name>: a shared evening's short link (core/src/short-slugs.ts),
 * sent to the evening's page here for good.
 */
export default async function SharedEvening({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const long = await longSlugForShortLink(db, `shared/${slug}`);
  return long === null
    ? notFound()
    : permanentRedirect(`/${encodeURIComponent(long)}`);
}
