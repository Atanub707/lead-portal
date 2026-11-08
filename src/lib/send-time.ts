export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function zonedParts(date: Date, timezone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });
  const values: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== "literal") values[part.type] = part.value;
  }
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
    weekday: WEEKDAY_INDEX[values.weekday] ?? 0,
  };
}

function offsetMs(date: Date, timezone: string): number {
  const parts = zonedParts(date, timezone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return asUtc - date.getTime();
}

export function dateKey(date: Date, timezone: string): string {
  const parts = zonedParts(date, timezone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function parseDateKey(key: string): { year: number; month: number; day: number } {
  const [year, month, day] = key.split("-").map(Number);
  return { year, month, day };
}

export function addDaysToKey(key: string, days: number): string {
  const { year, month, day } = parseDateKey(key);
  const base = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0));
  return `${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(2, "0")}-${String(base.getUTCDate()).padStart(2, "0")}`;
}

export function weekdayForKey(key: string): number {
  const { year, month, day } = parseDateKey(key);
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0)).getUTCDay();
}

export function daysBetweenKeys(from: string, to: string): number {
  const a = parseDateKey(from);
  const b = parseDateKey(to);
  const start = Date.UTC(a.year, a.month - 1, a.day, 12);
  const end = Date.UTC(b.year, b.month - 1, b.day, 12);
  return Math.round((end - start) / 86_400_000);
}

export function zonedDateTimeToUtc(
  key: string,
  time: string,
  timezone: string
): Date {
  const { year, month, day } = parseDateKey(key);
  const [hour, minute] = time.split(":").map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute, 0);
  let guess = target;
  for (let i = 0; i < 3; i += 1) {
    const offset = offsetMs(new Date(guess), timezone);
    const next = target - offset;
    if (next === guess) break;
    guess = next;
  }
  return new Date(guess);
}

export function dayRangeUtc(key: string, timezone: string): { start: Date; end: Date } {
  return {
    start: zonedDateTimeToUtc(key, "00:00", timezone),
    end: zonedDateTimeToUtc(addDaysToKey(key, 1), "00:00", timezone),
  };
}

export function windowForDateKey(
  key: string,
  timezone: string,
  start: string,
  end: string
): { start: Date; end: Date } {
  return {
    start: zonedDateTimeToUtc(key, start, timezone),
    end: zonedDateTimeToUtc(key, end, timezone),
  };
}

export function isWithinWindow(
  date: Date,
  timezone: string,
  weekdays: number[],
  start: string,
  end: string
): boolean {
  const parts = zonedParts(date, timezone);
  if (!weekdays.includes(parts.weekday)) return false;
  const minutes = parts.hour * 60 + parts.minute;
  const [startHour, startMinute] = start.split(":").map(Number);
  const [endHour, endMinute] = end.split(":").map(Number);
  return minutes >= startHour * 60 + startMinute && minutes < endHour * 60 + endMinute;
}

export function localTimeLabel(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}
