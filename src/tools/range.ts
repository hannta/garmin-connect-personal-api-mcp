// Shared handling for range tools: the default 7-day range, the per-tool maximum (one
// Garmin request per source, so a longer range is an error asking the assistant to split
// it), and the plain `summary` statistics every range result carries.

import { DateInputError, addDays, daysInclusive, parseIsoDate } from '../lib/dates';
import { round } from '../lib/units';
import type { ToolContext } from './context';
import { dateInput } from './define';

export const DEFAULT_RANGE_DAYS = 7;

export function rangeInput(maxDays: number) {
  return {
    start_date: dateInput(
      `First day, YYYY-MM-DD in the user's time zone. Default: ${DEFAULT_RANGE_DAYS - 1} days before end_date. At most ${maxDays} days per call.`,
    ),
    end_date: dateInput(
      `Last day (inclusive), YYYY-MM-DD. Default: today, or ${DEFAULT_RANGE_DAYS - 1} days after start_date (not past today).`,
    ),
  };
}

export interface RangeInput {
  start_date?: string | undefined;
  end_date?: string | undefined;
}

export interface DateRange {
  start: string;
  end: string;
}

/**
 * Neither date → the 7 days ending today; one date → 7 days from or to it (never past
 * today). Ranges longer than `maxDays` are rejected rather than split.
 */
export async function resolveRange(
  input: RangeInput,
  context: ToolContext,
  maxDays: number,
  what: string,
): Promise<DateRange> {
  const today = await context.today();
  const span = DEFAULT_RANGE_DAYS - 1;
  let { start_date: start, end_date: end } = input;
  if (start && !end) {
    const week = addDays(parseIsoDate(start), span);
    end = week < today ? week : today;
  }
  end ??= today;
  start ??= addDays(parseIsoDate(end), -span);

  const days = daysInclusive(start, end);
  if (days < 1) throw new DateInputError(`Start date ${start} is after end date ${end}.`);
  if (days > maxDays) {
    throw new DateInputError(
      `${what} cover at most ${maxDays} days per call, and ${start} – ${end} is ${days} days. Split the range into calls of up to ${maxDays} days.`,
    );
  }
  return { start, end };
}

type Maybe = number | null | undefined;

export interface Stats {
  avg: number | null;
  min: number | null;
  max: number | null;
  /** Rows with a value. */
  days: number;
}

/** Average (1 decimal), min, max and count of the values that are present. */
export function stats(values: Maybe[]): Stats | null {
  const present = values.filter((value): value is number => typeof value === 'number');
  if (present.length === 0) return null;
  const sum = present.reduce((total, value) => total + value, 0);
  return {
    avg: round(sum / present.length, 1),
    min: Math.min(...present),
    max: Math.max(...present),
    days: present.length,
  };
}

/** `summary` for a range result: `stats` for each named numeric field of the rows. */
export function summarize<Row extends object>(rows: Row[], fields: (keyof Row & string)[]) {
  return Object.fromEntries(
    fields.map((field) => [field, stats(rows.map((row) => row[field] as Maybe))]),
  );
}
