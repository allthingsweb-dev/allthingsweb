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

// Measured from the start of the request: no new cover starts after the first
// deadline, and the one in progress is cancelled at the second, leaving time to
// clean up, revalidate and respond within maxDuration.
const coverStartDeadlineMs = 35_000;
const coverCancelDeadlineMs = 50_000;

const listingPaths = ["/", "/api/v1/events", "/rss", "/sitemap.xml"];

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

  const startedAt = Date.now();
  try {
    const { slugs, ...result } = await syncPublicLumaEvents(
      db,
      mainConfig.luma.calendarApiId,
    );
    // Publish the sync before cover work, which may run out the clock.
    for (const path of [...listingPaths, ...slugs.map((slug) => `/${slug}`)]) {
      revalidatePath(path);
    }
    // Covers are best effort: a failure here must not hide a successful sync.
    const elapsedMs = Date.now() - startedAt;
    const coverBudgetMs = coverStartDeadlineMs - elapsedMs;
    const covers =
      coverBudgetMs <= 0
        ? { skipped: "No time left for covers in this run" }
        : await ingestMissingLumaCovers({
            budgetMs: coverBudgetMs,
            signal: AbortSignal.timeout(coverCancelDeadlineMs - elapsedMs),
          }).catch((error: unknown) => {
            captureException(error);
            return {
              skipped: `Cover ingestion failed: ${error instanceof Error ? error.message : String(error)}`,
            };
          });
    if ("ingested" in covers && covers.ingested.length > 0) {
      for (const path of [
        ...listingPaths,
        ...covers.ingested.map((slug) => `/${slug}`),
      ]) {
        revalidatePath(path);
      }
    }
    // JSON so nested cover failures are logged in full, not as [Object].
    console.info(
      "Luma calendar sync completed",
      JSON.stringify({ ...result, covers }),
    );

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
