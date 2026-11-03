import { z } from 'zod';
import { getSpo2 } from '../garmin/endpoints';
import type { Spo2Day } from '../garmin/types';
import { garminGmtToLocalIso } from '../lib/dates';
import { round } from '../lib/units';
import { dateInput, defineTool } from './define';
import { positive } from './summaries';

export const getSpo2Tool = defineTool({
  name: 'garmin_get_spo2',
  title: 'Get Garmin SpO2',
  description: [
    "One day's blood oxygen (Pulse Ox): average, lowest and latest SpO2 (%), the average",
    "during sleep and Garmin's 7-day average. Set include_samples for hourly averages",
    'with altitude (m), e.g. for altitude acclimation. SpO2 is only recorded when Pulse Ox',
    'is on in the watch settings.',
  ].join(' '),
  inputSchema: z.object({
    date: dateInput("Calendar date, YYYY-MM-DD. Default: today in the user's time zone."),
    include_samples: z
      .boolean()
      .optional()
      .describe('Include hourly SpO2 and altitude. Default false.'),
  }),
  async run(input, context) {
    const zone = await context.timeZone();
    const date = input.date ?? (await context.today());
    const spo2 = await getSpo2(context.client, date);
    return {
      ...formatSpo2(spo2, date, zone.timeZone, input.include_samples ?? false),
      warning: zone.warning,
    };
  },
});

export function formatSpo2(spo2: Spo2Day, date: string, timeZone: string, includeSamples: boolean) {
  const hourly = (spo2.spO2HourlyAverages ?? []).map(([at, level, altitude]) => ({
    time: garminGmtToLocalIso(at, timeZone)?.slice(11, 16),
    spo2_pct: positive(level),
    altitude_m: round(altitude),
  }));
  const fields = {
    avg_pct: positive(spo2.averageSpO2),
    lowest_pct: positive(spo2.lowestSpO2),
    latest_pct: positive(spo2.latestSpO2),
    avg_sleep_pct: positive(spo2.avgSleepSpO2),
    avg_7d_pct: positive(spo2.lastSevenDaysAvgSpO2),
  };
  const recorded =
    Object.values(fields).some((value) => value !== null) ||
    hourly.some((hour) => hour.spo2_pct !== null);
  const altitudes = hourly.map((hour) => hour.altitude_m).filter((m) => m !== null);
  return {
    date,
    time_zone: timeZone,
    ...fields,
    no_data: recorded ? null : true,
    note: recorded ? null : 'No SpO2 readings for this date (Pulse Ox may be off).',
    avg_altitude_m:
      altitudes.length > 0
        ? round(altitudes.reduce((sum, m) => sum + m, 0) / altitudes.length)
        : null,
    hourly: includeSamples && hourly.length > 0 ? hourly : null,
  };
}
