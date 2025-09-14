import { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { redirectsTable } from "@/lib/schema";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  
  if (!id) {
    return new Response("No id provided", { status: 400 });
  }

  let redirectLink;

  try {
    // Query the database for the redirect link
    const results = await db
      .select()
      .from(redirectsTable)
      .where(eq(redirectsTable.slug, id))
      .limit(1);

    redirectLink = results[0];

    if (!redirectLink) {
      return new Response("Redirect not found", { status: 404 });
    }
  } catch (error) {
    console.error("Error fetching redirect link:", error);
    return new Response("Internal server error", { status: 500 });
  }

  // Redirect to the destination URL (moved permanently for SEO authority)
  // Note: redirect() will throw NEXT_REDIRECT which Next.js handles automatically
  redirect(redirectLink.destinationUrl);
}
