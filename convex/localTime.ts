const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string) {
  let format = formatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(timeZone, format);
  }
  return format;
}

export function isTimeZone(timeZone: string) {
  try {
    formatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

function wallClock(time: number, timeZone: string) {
  const parts: Partial<Record<Intl.DateTimeFormatPartTypes, number>> = {};
  for (const { type, value } of formatter(timeZone).formatToParts(time)) {
    parts[type] = Number(value);
  }
  return Date.UTC(
    parts.year!,
    parts.month! - 1,
    parts.day!,
    parts.hour! % 24,
    parts.minute!,
    parts.second!,
  );
}

function offset(time: number, timeZone: string) {
  return wallClock(time, timeZone) - Math.floor(time / 1000) * 1000;
}

function toUtc(wallTime: number, timeZone: string) {
  const guess = wallTime - offset(wallTime, timeZone);
  return wallTime - offset(guess, timeZone);
}

function localDay(time: number, timeZone: string) {
  return Math.floor(wallClock(time, timeZone) / DAY_MS) * DAY_MS;
}

function isoDate(day: number) {
  return new Date(day).toISOString().slice(0, 10);
}

export function localDate(time: number, timeZone: string) {
  return isoDate(localDay(time, timeZone));
}

export function startOfLocalDay(time: number, timeZone: string) {
  return toUtc(localDay(time, timeZone), timeZone);
}

export function nextLocalTime(
  after: number,
  timeZone: string,
  minutes: number,
  skipDate?: string,
) {
  for (let day = localDay(after, timeZone); ; day += DAY_MS) {
    const at = toUtc(day + minutes * MINUTE_MS, timeZone);
    if (at > after && isoDate(day) !== skipDate) {
      return at;
    }
  }
}
