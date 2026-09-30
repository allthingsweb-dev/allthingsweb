import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { captureException } from "@sentry/nextjs";
import { mainConfig } from "@/lib/config";
import { db } from "@/lib/db";
import { syncPublicLumaEvents } from "@/lib/luma/sync";
import { ingestMissingLumaCovers } from "@/lib/event-covers/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const maxDuration = 60;

function isAuthorized(request: Request, cronSecret: string): boolean {
  return request.headers.get("authorization") === `Bearer ${cronSecret}`;
}

export async function GET(request: Request) {
  const cronSecret = mainConfig.cron.secret?.trim();

  if (!cronSecret) {
    return NextResponse.json(
      {
        ok: false,
        error: "Server misconfigured: CRON_SECRET is not set",
      },
      { status: 500 },
    );
  }

  if (!isAuthorized(request, cronSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { slugs, ...result } = await syncPublicLumaEvents(
      db,
      mainConfig.luma.calendarApiId,
    );
    // Covers are best effort: a failure here must not hide a successful sync.
    const covers = await ingestMissingLumaCovers().catch((error: unknown) => {
      captureException(error);
      return {
        skipped: `Cover ingestion failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    });
    const coveredSlugs = "ingested" in covers ? covers.ingested : [];
    for (const path of [
      "/",
      "/api/v1/events",
      "/rss",
      "/sitemap.xml",
      ...[...slugs, ...coveredSlugs].map((slug) => `/${slug}`),
    ]) {
      revalidatePath(path);
    }
    console.info("Luma calendar sync completed", { ...result, covers });

    return NextResponse.json({
      ok: true,
      ...result,
      covers,
    });
  } catch (error) {
    captureException(error);
    console.error("Luma calendar sync failed", error);
    const message = error instanceof Error ? error.message : "Unknown error";

    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
