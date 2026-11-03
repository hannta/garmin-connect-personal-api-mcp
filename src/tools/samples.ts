// Averages time series (all-day heart rate, overnight HRV, SpO2, Body Battery) per
// local clock interval, so a day of samples becomes a few dozen rows.

import { parseGarminGmt, toLocalIso } from '../lib/dates';
import { round } from '../lib/units';

export interface Sample {
  /** Garmin GMT time: epoch ms or a GMT string. */
  at: string | number | null | undefined;
  value: number | null | undefined;
}

/**
 * Average values per local `minutes` interval, e.g. [{ time: "02:30", value: 51 }], in
 * sample order. Keys are clock times, so use it for one day (or night) at a time.
 */
export function averagePerInterval(
  samples: Iterable<Sample>,
  timeZone: string,
  minutes: number,
  decimals = 0,
): { time: string; value: number | null }[] {
  const buckets = new Map<string, number[]>();
  for (const sample of samples) {
    const at = parseGarminGmt(sample.at);
    if (!at || typeof sample.value !== 'number') continue;
    const local = toLocalIso(at, timeZone);
    const minute = Number(local.slice(14, 16));
    const key = `${local.slice(11, 13)}:${String(minute - (minute % minutes)).padStart(2, '0')}`;
    const values = buckets.get(key) ?? [];
    values.push(sample.value);
    buckets.set(key, values);
  }
  // Map keeps insertion order, and Garmin returns samples in time order.
  return [...buckets].map(([time, values]) => ({
    time,
    value: round(values.reduce((sum, value) => sum + value, 0) / values.length, decimals),
  }));
}
