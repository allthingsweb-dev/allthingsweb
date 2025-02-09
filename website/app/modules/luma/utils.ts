export function getLumaUrl(lumaEventId?: string | null): string | null {
  if (!lumaEventId) return null;
  return `https://lu.ma/${lumaEventId}`;
}
