import { z } from 'zod';
import { getDailySummaries, getHrv, getSleep, searchActivities } from '../garmin/endpoints';
import type { ActivitySummary, DailySleep, DailySummary, HrvDay } from '../garmin/types';
import { formatHoursMinutes, round } from '../lib/units';
import { dateInput, defineTool } from './define';
import { activityRow } from './format';
import { hasSleepData } from './get-sleep';
import { settledValue, settledWarning } from './result';

export const getDayTool = defineTool({
  name: 'garmin_get_day',
  title: 'Get a Garmin day',
  description: [
    'One day at a glance, for readiness and recovery questions: resting heart rate, Body',
    "Battery, stress, intensity minutes, steps, the previous night's sleep (keyed by this",
    "wake-up date) and HRV summary, and a compact list of that day's activities.",
    'For "should I train hard today?", call it for today and yesterday.',
    'For detail, use garmin_get_sleep, garmin_get_hrv and garmin_get_activity.',
  ].join(' '),
  inputSchema: z.object({
    date: dateInput("Calendar date, YYYY-MM-DD. Default: today in the user's time zone."),
  }),
  async run(input, context) {
    const zone = await context.timeZone();
    const date = input.date ?? (await context.today());
    const client = context.client;

    const [summaries, sleep, hrv, activities] = await Promise.allSettled([
      getDailySummaries(client, date, date),
      getSleep(client, date),
      getHrv(client, date),
      searchActivities(client, { start: date, end: date, limit: 50 }),
    ]);

    // A day with every source failing is an error; otherwise return what we have.
    const results = [summaries, sleep, hrv, activities];
    const failed = results.filter((result) => result.status === 'rejected');
    if (failed.length === results.length) throw failed[0]?.reason;

    const warnings = [
      zone.warning,
      settledWarning('Daily summary', summaries),
      settledWarning('Sleep', sleep),
      settledWarning('HRV', hrv),
      settledWarning('Activities', activities),
    ].filter((warning): warning is string => Boolean(warning));

    return formatDay(
      date,
      zone.timeZone,
      {
        summary: settledValue(summaries)?.[0],
        sleep: settledValue(sleep),
        hrv: settledValue(hrv),
        activities: settledValue(activities),
      },
      warnings,
    );
  },
});

export interface DayData {
  summary?: DailySummary | undefined;
  sleep?: DailySleep | undefined;
  hrv?: HrvDay | undefined;
  activities?: ActivitySummary[] | undefined;
}

export function formatDay(date: string, timeZone: string, data: DayData, warnings: string[] = []) {
  const { summary, sleep, hrv, activities } = data;
  const moderate = summary?.intensityMinutes?.moderate;
  const vigorous = summary?.intensityMinutes?.vigorous;
  const hrvSummary = hrv?.hrvSummary;
  return {
    date,
    time_zone: timeZone,
    resting_hr_bpm: summary?.heartRate?.restingValue,
    heart_rate: { min_bpm: summary?.heartRate?.minValue, max_bpm: summary?.heartRate?.maxValue },
    body_battery: {
      latest: summary?.bodyBattery?.latestValue,
      max: summary?.bodyBattery?.maxValue,
      min: summary?.bodyBattery?.minValue,
      charged: summary?.bodyBattery?.chargedValue,
      drained: summary?.bodyBattery?.drainedValue,
    },
    stress: { avg: summary?.stress?.avgLevel, max: summary?.stress?.maxLevel },
    intensity_minutes: {
      moderate,
      vigorous,
      // Garmin counts vigorous minutes double toward the weekly goal.
      total:
        typeof moderate === 'number' && typeof vigorous === 'number'
          ? moderate + 2 * vigorous
          : null,
      weekly_goal: summary?.intensityMinutes?.goal,
    },
    steps: summary?.movement?.steps?.value,
    avg_respiration_brpm: round(summary?.respiration?.avgValue, 1),
    sleep: hasSleepData(sleep ?? null)
      ? {
          duration: formatHoursMinutes(sleep?.sleepTimeSeconds),
          score: sleep?.sleepScores?.overall?.value,
          qualifier: sleep?.sleepScores?.overall?.qualifierKey,
          deep: formatHoursMinutes(sleep?.deepSleepSeconds),
          rem: formatHoursMinutes(sleep?.remSleepSeconds),
          awake: formatHoursMinutes(sleep?.awakeSleepSeconds),
          avg_sleep_stress: round(sleep?.avgSleepStress),
        }
      : null,
    hrv: hrvSummary
      ? {
          last_night_avg_ms: hrvSummary.lastNightAvg,
          weekly_avg_ms: hrvSummary.weeklyAvg,
          balanced_range_ms: hrvSummary.baseline
            ? [hrvSummary.baseline.balancedLow, hrvSummary.baseline.balancedUpper]
            : null,
          status: hrvSummary.status,
        }
      : null,
    activities: activities?.map(activityRow) ?? null,
    warnings: warnings.length > 0 ? warnings : null,
  };
}
