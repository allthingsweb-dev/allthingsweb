import { createLumaClient, type LumaEvent } from "@/lib/luma";

export function getLumaEventId(event: LumaEvent): string | null {
  const rawId = event.api_id ?? event.app_id;
  if (!rawId) return null;

  const id = rawId.trim();
  return id.length > 0 ? id : null;
}

export async function fetchLatestLumaEvents({
  limit,
  calendarApiId,
  calendarHandle,
}: {
  limit: number;
  calendarApiId?: string;
  calendarHandle?: string;
}): Promise<LumaEvent[]> {
  "use step";

  const lumaClient = createLumaClient();

  return lumaClient.getCalendarEvents({
    limit,
    after: new Date().toISOString(),
    calendarApiId,
    calendarHandle,
  });
}
