import { getDiscordReviewBot } from "@/lib/discord/review-bot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const bot = getDiscordReviewBot();
  return bot.webhooks.discord(request);
}
