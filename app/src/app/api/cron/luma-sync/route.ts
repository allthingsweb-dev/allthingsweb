import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { mainConfig } from "@/lib/config";
import { syncLumaEventsWorkflow } from "@/workflows/luma-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 10;
const DEFAULT_CALENDAR_HANDLE = "allthingswebcalendar";

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
    const calendarApiId = mainConfig.luma.calendarApiId;
    const calendarHandle =
      mainConfig.luma.calendarHandle ?? DEFAULT_CALENDAR_HANDLE;

    const run = await start(syncLumaEventsWorkflow, [
      {
        limit: DEFAULT_LIMIT,
        calendarApiId,
        calendarHandle,
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
