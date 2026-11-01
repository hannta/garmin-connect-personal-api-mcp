import { z } from 'zod';
import { getHrv } from '../garmin/endpoints';
import { GarminError } from '../garmin/errors';
import type { HrvDay, HrvReading, HrvSummary } from '../garmin/types';
import { parseGarminGmt, toLocalIso } from '../lib/dates';
import { round } from '../lib/units';
import { dateInput, defineTool } from './define';

const BUCKET_MINUTES = 30;

export const getHrvTool = defineTool({
  name: 'garmin_get_hrv',
  title: 'Get Garmin HRV',
  description: [
    "One night's heart-rate variability from Garmin: last-night average, 5-minute high,",
    '7-day average, personal baseline range, HRV status (e.g. BALANCED, UNBALANCED, LOW)',
    `and overnight readings averaged per ${BUCKET_MINUTES} minutes.`,
    'Keyed by the wake-up date, like sleep. HRV is in milliseconds (RMSSD).',
  ].join(' '),
  inputSchema: z.object({
    date: dateInput("Wake-up date, YYYY-MM-DD. Default: today in the user's time zone."),
  }),
  async run(input, context) {
    const zone = await context.timeZone();
    const date = input.date ?? (await context.today());
    const hrv = await getHrv(context.client, date).catch((error: unknown) => {
      if (error instanceof GarminError && error.code === 'not_found') return null;
      throw error;
    });
    return { ...formatHrv(hrv, date, zone.timeZone), warning: zone.warning };
  },
});

export function hrvSummaryFields(summary: HrvSummary) {
  return {
    last_night_avg_ms: summary.lastNightAvg,
    last_night_5min_high_ms: summary.lastNight5MinHigh,
    weekly_avg_ms: summary.weeklyAvg,
    baseline: summary.baseline
      ? {
          balanced_low_ms: summary.baseline.balancedLow,
          balanced_upper_ms: summary.baseline.balancedUpper,
          low_upper_ms: summary.baseline.lowUpper,
        }
      : null,
    status: summary.status,
    feedback: summary.feedbackPhrase,
  };
}

/** Average readings per local half hour, e.g. { time: "02:30", hrv_ms: 51 }. */
export function bucketReadings(readings: HrvReading[] | null | undefined, timeZone: string) {
  const buckets = new Map<string, number[]>();
  for (const reading of readings ?? []) {
    const at = parseGarminGmt(reading.readingTimeGMT);
    if (!at || typeof reading.hrvValue !== 'number') continue;
    const local = toLocalIso(at, timeZone);
    const minute = Number(local.slice(14, 16));
    const key = `${local.slice(11, 13)}:${String(minute - (minute % BUCKET_MINUTES)).padStart(2, '0')}`;
    const values = buckets.get(key) ?? [];
    values.push(reading.hrvValue);
    buckets.set(key, values);
  }
  // Map keeps insertion order, and Garmin returns readings in time order.
  return [...buckets].map(([time, values]) => ({
    time,
    hrv_ms: round(values.reduce((sum, value) => sum + value, 0) / values.length),
  }));
}

export function formatHrv(hrv: HrvDay | null, date: string, timeZone: string) {
  const summary = hrv?.hrvSummary;
  if (!summary) {
    return {
      date,
      time_zone: timeZone,
      no_data: true,
      note: 'No HRV recorded for the night ending on this date.',
    };
  }
  const readings = bucketReadings(hrv.hrvReadings, timeZone);
  return {
    date,
    time_zone: timeZone,
    ...hrvSummaryFields(summary),
    overnight: readings.length > 0 ? readings : null,
  };
}
