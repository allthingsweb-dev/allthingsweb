import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";
import { cutoverConfig } from "@/lib/cutover/config";
import { cutoverCacheControl, cutoverRedirect } from "@/lib/cutover/redirect";
import { databaseConfig } from "@/lib/database/config";
import { shortLinkForLongSlug } from "@/lib/short-links";

/** Paths the site's own pages are served at, which learn their path. */
const pagePath = /^\/(?!api|media\/|_next\/static|_next\/image|favicon\.ico)/;

/** The database, made the first time a long slug is looked up. */
let database: ReturnType<typeof drizzle> | undefined;
const shortLink = (slug: string) => {
  database ??= drizzle({ client: neon(databaseConfig.databaseUrl) });
  return shortLinkForLongSlug(database, slug);
};

export async function middleware(request: NextRequest) {
  // The cutover: everything goes to allthings.dev (src/lib/cutover).
  if (cutoverConfig.redirectToAllthingsDev) {
    const { status, location } = await cutoverRedirect(
      {
        method: request.method,
        pathname: request.nextUrl.pathname,
        search: request.nextUrl.search,
      },
      shortLink,
    );
    const response = NextResponse.redirect(location, status);
    response.headers.set("cache-control", cutoverCacheControl);
    return response;
  }

  if (!pagePath.test(request.nextUrl.pathname)) return NextResponse.next();
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", request.nextUrl.pathname);

  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
}

export const config = {
  // Every path, so the cutover can redirect all of them; without it, only
  // pages learn their path (pagePath), as before: not the API, Next's
  // static files and image optimizer, stored images or the favicon.
  matcher: ["/:path*"],
};
