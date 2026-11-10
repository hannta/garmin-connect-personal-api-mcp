import { z } from 'zod';
import { getDailySummaries, getHrv, getSleep, searchActivities } from '../garmin/endpoints';
import type { ActivitySummary, DailySleep, DailySummary, HrvDay } from '../garmin/types';
import { localIsoFromPair } from '../lib/dates';
import { formatHoursMinutes, round } from '../lib/units';
import { dateInput, defineTool } from './define';
import { activityRow } from './format';
import { hasSleepData } from './get-sleep';
import { settledValue, settledWarning } from './result';
import { minutes, nonNegative, positive } from './summaries';
import { bodyBatteryEvent, bodyBatteryFeedback } from './wellness';

export const getDayTool = defineTool({
  name: 'garmin_get_day',
  title: 'Get a Garmin day',
  description: [
    'One day at a glance, for readiness and recovery questions: resting heart rate, Body',
    'Battery (with the sleep and activity events behind it), stress and minutes per stress',
    'level, intensity minutes, steps, calories (burned, and eaten if food is logged),',
    "logged hydration, heart-rate alerts, the previous night's sleep (keyed by this",
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
        sleep: settledValue(sleep) ?? undefined,
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
  const stress = summary?.stress;
  return {
    date,
    time_zone: timeZone,
    // As in the range tools: Garmin's 0 (heart rate, respiration, calories) and negative
    // stress values mean "no data" and are left out.
    resting_hr_bpm: positive(summary?.heartRate?.restingValue),
    heart_rate: {
      min_bpm: positive(summary?.heartRate?.minValue),
      max_bpm: positive(summary?.heartRate?.maxValue),
      alerts: summary?.heartRate?.alertCount || null,
    },
    body_battery: {
      latest: summary?.bodyBattery?.latestValue,
      before_sleep: summary?.bodyBattery?.endOfDayValue,
      max: summary?.bodyBattery?.maxValue,
      min: summary?.bodyBattery?.minValue,
      charged: summary?.bodyBattery?.chargedValue,
      drained: summary?.bodyBattery?.drainedValue,
      events: summary?.bodyBattery?.activityEvents?.map((event) =>
        bodyBatteryEvent({
          type: event.eventType,
          start: localIsoFromPair(event.eventStartTimeLocal, event.eventStartTimeGmt),
          durationMs: event.durationInMillis,
          impact: event.bodyBatteryImpact,
          shortFeedback: event.shortFeedback,
        }),
      ),
      feedback: bodyBatteryFeedback(summary?.bodyBattery?.dynamicFeedbackEvent),
    },
    stress: {
      avg: nonNegative(stress?.avgLevel),
      max: nonNegative(stress?.maxLevel),
      rest_min: minutes(msToSeconds(stress?.restDurationInMillis)),
      low_min: minutes(msToSeconds(stress?.lowStressDurationInMillis)),
      medium_min: minutes(msToSeconds(stress?.mediumStressDurationInMillis)),
      high_min: minutes(msToSeconds(stress?.highStressDurationInMillis)),
      activity_min: minutes(msToSeconds(stress?.activityDurationInMillis)),
    },
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
    calories_kcal: {
      total: positive(summary?.calories?.burnedTotal),
      active: summary?.calories?.burnedActive,
      eaten: summary?.calories?.consumedValue,
      eaten_goal: summary?.calories?.consumedValue != null ? summary.calories.consumedGoal : null,
    },
    hydration_ml: hydration(summary),
    avg_respiration_brpm: round(positive(summary?.respiration?.avgValue), 1),
    sleep: hasSleepData(sleep ?? null)
      ? {
          duration: formatHoursMinutes(sleep?.sleepTimeSeconds),
          score: sleep?.sleepScores?.overall?.value,
          qualifier: sleep?.sleepScores?.overall?.qualifierKey,
          deep: formatHoursMinutes(sleep?.deepSleepSeconds),
          rem: formatHoursMinutes(sleep?.remSleepSeconds),
          awake: formatHoursMinutes(sleep?.awakeSleepSeconds),
          avg_sleep_stress: round(nonNegative(sleep?.avgSleepStress)),
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

function msToSeconds(ms: number | null | undefined): number | null {
  return typeof ms === 'number' ? ms / 1000 : null;
}

/** Logged water intake; null when nothing was logged. */
function hydration(summary: DailySummary | undefined) {
  const intake = round(
    summary?.hydration?.consumedInMl ?? summary?.hydration?.consumedInFractionalMl,
  );
  return intake ? { intake, goal: summary?.hydration?.goalInMl } : null;
}
