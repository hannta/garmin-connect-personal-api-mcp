import { z } from 'zod';
import { getSleep } from '../garmin/endpoints';
import { GarminError } from '../garmin/errors';
import type { DailySleep, SleepScoreItem } from '../garmin/types';
import { garminGmtToLocalIso } from '../lib/dates';
import { formatHoursMinutes, round } from '../lib/units';
import { dateInput, defineTool } from './define';

export const getSleepTool = defineTool({
  name: 'garmin_get_sleep',
  title: 'Get Garmin sleep',
  description: [
    'One night of sleep from Garmin: start and end time, total sleep, stages',
    '(deep / light / REM / awake), sleep score with qualifiers, sleep need, average heart',
    'rate, respiration, SpO2 and sleep stress.',
    'Nights are keyed by the wake-up date: "last night" is today\'s date.',
  ].join(' '),
  inputSchema: z.object({
    date: dateInput(
      "Wake-up date (the morning the night ended), YYYY-MM-DD. Default: today in the user's time zone.",
    ),
  }),
  async run(input, context) {
    const zone = await context.timeZone();
    const date = input.date ?? (await context.today());
    const sleep = await getSleep(context.client, date).catch((error: unknown) => {
      if (error instanceof GarminError && error.code === 'not_found') return null;
      throw error;
    });
    return { ...formatSleep(sleep, date, zone.timeZone), warning: zone.warning };
  },
});

export function hasSleepData(sleep: DailySleep | null): sleep is DailySleep {
  return typeof sleep?.sleepTimeSeconds === 'number' && sleep.sleepTimeSeconds > 0;
}

function stage(seconds: number | null | undefined, total: number) {
  return {
    duration: formatHoursMinutes(seconds),
    minutes: typeof seconds === 'number' ? round(seconds / 60) : null,
    percent: typeof seconds === 'number' && total > 0 ? round((seconds / total) * 100) : null,
  };
}

function score(item: SleepScoreItem | null | undefined) {
  return item ? { value: item.value, qualifier: item.qualifierKey } : null;
}

export function formatSleep(sleep: DailySleep | null, date: string, timeZone: string) {
  if (!hasSleepData(sleep)) {
    return {
      date,
      time_zone: timeZone,
      no_data: true,
      note: 'No sleep recorded for the night ending on this date.',
    };
  }
  const total = sleep.sleepTimeSeconds ?? 0;
  const scores = sleep.sleepScores;
  return {
    date,
    time_zone: timeZone,
    sleep_start: garminGmtToLocalIso(sleep.sleepStartTimestampGMT, timeZone),
    sleep_end: garminGmtToLocalIso(sleep.sleepEndTimestampGMT, timeZone),
    duration: formatHoursMinutes(total),
    duration_s: total,
    score: {
      overall: scores?.overall?.value,
      qualifier: scores?.overall?.qualifierKey,
      feedback: sleep.sleepScoreFeedback,
      insight: sleep.sleepScoreInsight,
    },
    score_components: {
      total_duration: score(scores?.totalDuration),
      stress: score(scores?.stress),
      awake_count: score(scores?.awakeCount),
      restlessness: score(scores?.restlessness),
      deep_percentage: score(scores?.deepPercentage),
      light_percentage: score(scores?.lightPercentage),
      rem_percentage: score(scores?.remPercentage),
    },
    stages: {
      deep: stage(sleep.deepSleepSeconds, total),
      light: stage(sleep.lightSleepSeconds, total),
      rem: stage(sleep.remSleepSeconds, total),
      awake: { ...stage(sleep.awakeSleepSeconds, total), percent: null },
    },
    awake_count: sleep.awakeCount,
    nap: sleep.napTimeSeconds ? formatHoursMinutes(sleep.napTimeSeconds) : null,
    avg_hr_bpm: round(sleep.avgHeartRate),
    avg_respiration_brpm: round(sleep.averageRespirationValue, 1),
    avg_spo2_pct: round(sleep.averageSpO2Value),
    lowest_spo2_pct: round(sleep.lowestSpO2Value),
    avg_sleep_stress: round(sleep.avgSleepStress),
    sleep_need: sleep.sleepNeed
      ? {
          baseline: formatHoursMinutes((sleep.sleepNeed.baseline ?? Number.NaN) * 60),
          adjusted: formatHoursMinutes((sleep.sleepNeed.actual ?? Number.NaN) * 60),
          feedback: sleep.sleepNeed.feedback,
        }
      : null,
  };
}
