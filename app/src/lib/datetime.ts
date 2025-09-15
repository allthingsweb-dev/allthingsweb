export function toReadableDateTimeStr(date: Date, includeTime = false): string {
  const options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "America/Los_Angeles",
  };

  if (includeTime) {
    options.hour = "numeric";
    options.minute = "2-digit";
    options.timeZoneName = "short";
  }

  return date.toLocaleDateString("en-US", options);
}

export function toWeekdayStr(date: Date): string {
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    timeZone: "America/Los_Angeles",
  });
}

export function toYearStr(date: Date): string {
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    timeZone: "America/Los_Angeles",
  });
}

export function toShortDateStr(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/Los_Angeles",
  });
}
