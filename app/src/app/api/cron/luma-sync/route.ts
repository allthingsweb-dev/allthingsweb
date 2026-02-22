import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { syncLumaEventsWorkflow } from "@/workflows/luma-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 10;
const DEFAULT_CALENDAR_HANDLE = "allthingswebcalendar";

function isAuthorized(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    return true;
  }

  return request.headers.get("authorization") === `Bearer ${cronSecret}`;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const run = await start(syncLumaEventsWorkflow, [
      {
        limit: DEFAULT_LIMIT,
        calendarHandle: DEFAULT_CALENDAR_HANDLE,
      },
    ]);

    return NextResponse.json({
      ok: true,
      runId: run.runId,
      message: "Luma sync workflow started",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";

    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
