import { describe, expect, it } from 'vitest';
import {
  DateInputError,
  addDays,
  daysInclusive,
  garminGmtToLocalIso,
  isValidTimeZone,
  localIsoFromPair,
  parseGarminGmt,
  parseIsoDate,
  resolveTimeZone,
  toLocalIso,
  todayIn,
  validateRange,
} from '../src/lib/dates';

describe('time zone resolution', () => {
  it('prefers a valid override, then the profile, then UTC', () => {
    expect(resolveTimeZone({ override: 'Europe/Helsinki', profile: 'Europe/Athens' })).toEqual({
      timeZone: 'Europe/Helsinki',
      source: 'override',
    });
    expect(resolveTimeZone({ override: '', profile: 'Europe/Athens' })).toEqual({
      timeZone: 'Europe/Athens',
      source: 'profile',
    });
    const fallback = resolveTimeZone({ override: 'Not/AZone', profile: null });
    expect(fallback.timeZone).toBe('UTC');
    expect(fallback.source).toBe('utc');
    expect(fallback.warning).toBeTypeOf('string');
  });

  it('validates IANA names', () => {
    expect(isValidTimeZone('Europe/Helsinki')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
  });
});

describe('today in a time zone', () => {
  it('rolls over at local midnight, not UTC midnight', () => {
    const lateUtc = new Date('2026-10-31T22:30:00Z');
    expect(todayIn('UTC', lateUtc)).toBe('2026-10-31');
    expect(todayIn('Europe/Helsinki', lateUtc)).toBe('2026-11-01');
    expect(todayIn('America/New_York', lateUtc)).toBe('2026-10-31');
  });
});

describe('calendar dates', () => {
  it('validates YYYY-MM-DD', () => {
    expect(parseIsoDate('2026-02-28')).toBe('2026-02-28');
    expect(() => parseIsoDate('2026-02-30')).toThrow(DateInputError);
    expect(() => parseIsoDate('2026-2-3')).toThrow(DateInputError);
  });

  it('adds days across month, year and DST boundaries', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-10-26', -2)).toBe('2026-10-24');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('counts and validates inclusive ranges', () => {
    expect(daysInclusive('2026-09-21', '2026-11-01')).toBe(42);
    expect(() => {
      validateRange('2026-11-02', '2026-11-01', 30);
    }).toThrow(/after/);
    expect(() => {
      validateRange('2026-01-01', '2026-12-31', 31);
    }).toThrow(/maximum is 31/);
    expect(() => {
      validateRange('2026-10-01', '2026-10-31', 31);
    }).not.toThrow();
  });
});

describe('Garmin timestamps', () => {
  it('parses the three GMT formats Garmin uses', () => {
    expect(parseGarminGmt(1772399400000)?.toISOString()).toBe('2026-03-01T21:10:00.000Z');
    expect(parseGarminGmt('2026-10-31T21:04:14.0')?.toISOString()).toBe('2026-10-31T21:04:14.000Z');
    expect(parseGarminGmt('2026-10-31T21:04:14.353')?.toISOString()).toBe(
      '2026-10-31T21:04:14.353Z',
    );
    expect(parseGarminGmt('2026-10-30 14:38:17')?.toISOString()).toBe('2026-10-30T14:38:17.000Z');
  });

  it('returns null for missing or malformed values', () => {
    expect(parseGarminGmt(null)).toBeNull();
    expect(parseGarminGmt('yesterday')).toBeNull();
    expect(parseGarminGmt(Number.NaN)).toBeNull();
  });
});

describe('local ISO output', () => {
  it('includes the offset, including across the October DST change', () => {
    // EU clocks go back at 01:00 UTC on 2026-10-25.
    expect(toLocalIso(new Date('2026-10-25T00:30:00Z'), 'Europe/Helsinki')).toBe(
      '2026-10-25T03:30:00+03:00',
    );
    expect(toLocalIso(new Date('2026-10-25T01:30:00Z'), 'Europe/Helsinki')).toBe(
      '2026-10-25T03:30:00+02:00',
    );
  });

  it('handles the March DST change and UTC', () => {
    // EU clocks go forward at 01:00 UTC on 2026-03-29.
    expect(toLocalIso(new Date('2026-03-29T00:30:00Z'), 'Europe/Helsinki')).toBe(
      '2026-03-29T02:30:00+02:00',
    );
    expect(toLocalIso(new Date('2026-03-29T01:30:00Z'), 'Europe/Helsinki')).toBe(
      '2026-03-29T04:30:00+03:00',
    );
    expect(toLocalIso(new Date('2026-03-29T01:30:00Z'), 'UTC')).toBe('2026-03-29T01:30:00+00:00');
  });

  it('converts Garmin GMT values to local ISO', () => {
    expect(garminGmtToLocalIso('2026-10-30 14:38:17', 'Europe/Helsinki')).toBe(
      '2026-10-30T16:38:17+02:00',
    );
    expect(garminGmtToLocalIso(undefined, 'Europe/Helsinki')).toBeNull();
  });
});

describe('localIsoFromPair', () => {
  it('derives the offset from Garmin local + GMT times', () => {
    expect(localIsoFromPair('2026-10-30 16:38:17', '2026-10-30 14:38:17')).toBe(
      '2026-10-30T16:38:17+02:00',
    );
    expect(localIsoFromPair('2026-07-01T06:00:00.0', '2026-07-01T10:00:00.0')).toBe(
      '2026-07-01T06:00:00-04:00',
    );
    expect(localIsoFromPair('2026-03-01 10:00:00', '2026-03-01 04:30:00')).toBe(
      '2026-03-01T10:00:00+05:30',
    );
  });

  it('falls back to wall time without GMT, and null without local time', () => {
    expect(localIsoFromPair('2026-10-30 16:38:17', null)).toBe('2026-10-30T16:38:17');
    expect(localIsoFromPair(undefined, '2026-10-30 14:38:17')).toBeNull();
  });
});
