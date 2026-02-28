import { after } from "next/server";
import { mainConfig } from "@/lib/config";
import { getDiscordReviewBot } from "@/lib/discord/review-bot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800;

function isAuthorized(request: Request): boolean {
  const cronSecret = mainConfig.cron.secret?.trim();
  if (!cronSecret) {
    return false;
  }

  return request.headers.get("authorization") === `Bearer ${cronSecret}`;
}

export async function GET(request: Request): Promise<Response> {
  const cronSecret = mainConfig.cron.secret?.trim();
  if (!cronSecret) {
    return new Response("CRON_SECRET not configured", { status: 500 });
  }

  if (!isAuthorized(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const bot = getDiscordReviewBot();
    const discordAdapter = bot.getAdapter("discord");
    const durationMs = 600 * 1000;
    const webhookUrl = `${mainConfig.instance.origin}/api/webhooks/discord`;

    return discordAdapter.startGatewayListener(
      { waitUntil: (task) => after(() => task) },
      durationMs,
      undefined,
      webhookUrl,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      `Failed to start Discord gateway listener: ${message}`,
      {
        status: 500,
      },
    );
  }
}
