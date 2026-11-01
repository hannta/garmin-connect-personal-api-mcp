// Dates and time zones. Garmin keys daily data by the user's local calendar date, while
// Workers run in UTC, so "today" and all output timestamps are computed in the user's
// IANA time zone.

export class DateInputError extends Error {
  override name = 'DateInputError';
}

export type TimeZoneSource = 'override' | 'profile' | 'utc';

export interface ResolvedTimeZone {
  timeZone: string;
  source: TimeZoneSource;
  warning?: string;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Override (TIMEZONE var) → Garmin profile `timeZone` → UTC with a warning. */
export function resolveTimeZone(options: {
  override?: string | null | undefined;
  profile?: string | null | undefined;
}): ResolvedTimeZone {
  const override = options.override?.trim();
  if (override && isValidTimeZone(override)) return { timeZone: override, source: 'override' };
  const profile = options.profile?.trim();
  if (profile && isValidTimeZone(profile)) return { timeZone: profile, source: 'profile' };
  return {
    timeZone: 'UTC',
    source: 'utc',
    warning: 'No valid time zone from TIMEZONE or the Garmin profile; dates use UTC.',
  };
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Validates a YYYY-MM-DD calendar date and returns it unchanged. */
export function parseIsoDate(value: string): string {
  const match = ISO_DATE.exec(value);
  if (match) {
    const [, y, m, d] = match.map(Number) as [number, number, number, number];
    const date = new Date(Date.UTC(y, m - 1, d));
    if (date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d) {
      return value;
    }
  }
  throw new DateInputError(`Invalid date "${value}". Use YYYY-MM-DD.`);
}

/** Today's calendar date (YYYY-MM-DD) in the given time zone. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function toUtcMidnight(date: string): number {
  const [y, m, d] = parseIsoDate(date).split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}

export function addDays(date: string, days: number): string {
  return new Date(toUtcMidnight(date) + days * 86_400_000).toISOString().slice(0, 10);
}

export function daysInclusive(start: string, end: string): number {
  return Math.round((toUtcMidnight(end) - toUtcMidnight(start)) / 86_400_000) + 1;
}

/** Validates an inclusive date range and its maximum length in days. */
export function validateRange(start: string, end: string, maxDays: number): void {
  parseIsoDate(start);
  parseIsoDate(end);
  const days = daysInclusive(start, end);
  if (days < 1) throw new DateInputError(`Start date ${start} is after end date ${end}.`);
  if (days > maxDays) {
    throw new DateInputError(`Date range is ${days} days; the maximum is ${maxDays}.`);
  }
}

const GARMIN_GMT = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/;

/**
 * Parses a Garmin GMT timestamp: epoch milliseconds, or "YYYY-MM-DDTHH:MM:SS.s" /
 * "YYYY-MM-DD HH:MM:SS" strings without an offset. Only use with GMT fields — Garmin's
 * `*Local` fields are local wall time encoded the same way and would be misread.
 */
export function parseGarminGmt(value: string | number | null | undefined): Date | null {
  if (typeof value === 'number') return Number.isFinite(value) ? new Date(value) : null;
  if (typeof value !== 'string') return null;
  const match = GARMIN_GMT.exec(value.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi, s, frac] = match;
  const ms = frac ? Number(frac.padEnd(3, '0')) : 0;
  return new Date(
    Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s), ms),
  );
}

/** ISO 8601 local time with offset, e.g. "2026-10-31T23:04:14+02:00". */
export function toLocalIso(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'longOffset',
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  const offsetName = get('timeZoneName'); // "GMT+02:00", or "GMT" at zero offset
  const offset = offsetName === 'GMT' ? '+00:00' : offsetName.replace('GMT', '');
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}${offset}`;
}

/**
 * ISO 8601 from a Garmin local + GMT pair (activities), e.g. "2026-10-30T16:38:17+02:00".
 * The offset is the difference between the two, so it reflects where the activity was
 * recorded rather than the profile time zone. Falls back to the local time without an
 * offset if the GMT value is missing.
 */
export function localIsoFromPair(
  local: string | null | undefined,
  gmt: string | null | undefined,
): string | null {
  const localDate = parseGarminGmt(local); // local wall time, parsed as if UTC
  if (!localDate) return null;
  const wallTime = localDate.toISOString().slice(0, 19);
  const gmtDate = parseGarminGmt(gmt);
  if (!gmtDate) return wallTime;
  const offsetMinutes = Math.round((localDate.getTime() - gmtDate.getTime()) / 60_000);
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${wallTime}${sign}${hh}:${mm}`;
}

/** Convenience: Garmin GMT value → local ISO string, or null. */
export function garminGmtToLocalIso(
  value: string | number | null | undefined,
  timeZone: string,
): string | null {
  const date = parseGarminGmt(value);
  return date ? toLocalIso(date, timeZone) : null;
}
