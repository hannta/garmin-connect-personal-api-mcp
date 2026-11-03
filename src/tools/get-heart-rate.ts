import { z } from 'zod';
import { getDailyHeartRate } from '../garmin/endpoints';
import type { DailyHeartRate } from '../garmin/types';
import { garminGmtToLocalIso } from '../lib/dates';
import { dateInput, defineTool } from './define';
import { averagePerInterval } from './samples';
import { positive } from './summaries';

const SAMPLE_MINUTES = 15;

export const getHeartRateTool = defineTool({
  name: 'garmin_get_heart_rate',
  title: 'Get Garmin heart rate',
  description: [
    "One day's all-day heart rate: resting, min and max, Garmin's 7-day resting average,",
    'and high / low heart-rate alerts (with the alert thresholds) if any fired.',
    `Set include_samples for heart rate through the day (averaged per ${SAMPLE_MINUTES} min),`,
    'e.g. to see when it settled after a hard session. For resting HR over a range use',
    'garmin_get_daily_summaries.',
  ].join(' '),
  inputSchema: z.object({
    date: dateInput("Calendar date, YYYY-MM-DD. Default: today in the user's time zone."),
    include_samples: z
      .boolean()
      .optional()
      .describe(`Include heart rate averaged per ${SAMPLE_MINUTES} minutes. Default false.`),
  }),
  async run(input, context) {
    const zone = await context.timeZone();
    const date = input.date ?? (await context.today());
    const heartRate = await getDailyHeartRate(context.client, date);
    return {
      ...formatHeartRate(heartRate, date, zone.timeZone, input.include_samples ?? false),
      warning: zone.warning,
    };
  },
});

export function formatHeartRate(
  heartRate: DailyHeartRate,
  date: string,
  timeZone: string,
  includeSamples: boolean,
) {
  const samples = (heartRate.heartRateValues ?? []).map(([at, value]) => ({
    at,
    value: positive(value),
  }));
  const fields = {
    resting_hr_bpm: positive(heartRate.restingHeartRate),
    min_hr_bpm: positive(heartRate.minHeartRate),
    max_hr_bpm: positive(heartRate.maxHeartRate),
    resting_hr_7d_avg_bpm: positive(heartRate.lastSevenDaysAvgRestingHeartRate),
  };
  if (Object.values(fields).every((value) => value === null)) {
    return { date, time_zone: timeZone, no_data: true, note: 'No heart rate for this date.' };
  }
  return {
    date,
    time_zone: timeZone,
    ...fields,
    abnormal_hr: abnormalHeartRate(heartRate, timeZone),
    samples: includeSamples
      ? averagePerInterval(samples, timeZone, SAMPLE_MINUTES).map(({ time, value }) => ({
          time,
          hr_bpm: value,
        }))
      : null,
  };
}

/** High / low heart-rate alerts; Garmin sends readings as [epoch ms, bpm]. */
function abnormalHeartRate(heartRate: DailyHeartRate, timeZone: string) {
  const alerts = (heartRate.abnormalHRValuesArray ?? [])
    .map(([at, bpm]) =>
      typeof at === 'number' && typeof bpm === 'number'
        ? { time: garminGmtToLocalIso(at, timeZone)?.slice(11, 16), hr_bpm: bpm }
        : null,
    )
    .filter((alert) => alert !== null);
  if (alerts.length === 0) return null;
  return {
    high_alert_bpm: positive(heartRate.abnormalHrThresholdValue),
    low_alert_bpm: positive(heartRate.lowAbnormalHrThresholdValue),
    alerts,
  };
}
