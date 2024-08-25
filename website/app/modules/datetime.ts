export function toReadableDateTimeStr(date: Date, omitTime = false): string {
  const hasMinutes = date.getMinutes() !== 0;
  if (omitTime) {
    // Example: "Wed, 01 Dec"
    return date.toLocaleDateString("en-US", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      timeZone: "America/Los_Angeles",
    });
  }
  // Example: "Wed, 01 Dec 12:00 PM"
  return date.toLocaleString("en-US", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: hasMinutes ? "2-digit" : undefined,
    timeZone: "America/Los_Angeles",
  });
}

export function toWeekdayStr(date: Date): string {
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    timeZone: "America/Los_Angeles",
  });
}