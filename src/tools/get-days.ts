// garmin_get_day over a range: one row per day joining daily summaries, sleep, HRV and
// activities. One Garmin request per source (four in total), never one per day.

import { z } from 'zod';
import {
  getDailySummaries,
  getHrvRange,
  getSleepRange,
  LIMITS,
  searchActivities,
} from '../garmin/endpoints';
import type { ActivitySummary } from '../garmin/types';
import { addDays } from '../lib/dates';
import { round } from '../lib/units';
import { defineTool } from './define';
import { hasSleepData } from './get-sleep';
import { rangeInput, resolveRange, summarize } from './range';
import { settledValue, settledWarning } from './result';
import { MAX_DAYS, dailyRow, hrvRow, sleepRow } from './summaries';

const MAX_RANGE_DAYS = MAX_DAYS.sleep;

export const getDaysTool = defineTool({
  name: 'garmin_get_days',
  title: 'Get Garmin days',
  description: [
    'garmin_get_day over a date range, one compact row per day, for "am I absorbing this',
    'training?" and other recovery-vs-load questions: resting heart rate, HRV and its',
    'status, sleep duration and score, Body Battery, stress, intensity minutes, steps,',
    "and that day's activity count, duration, distance and training load. `summary` has",
    'average / min / max per field.',
    `Defaults to the last 7 days; at most ${MAX_RANGE_DAYS} days per call.`,
    'For one field in more detail use garmin_get_daily_summaries, garmin_get_sleep_summaries,',
    'garmin_get_hrv_summaries or garmin_search_activities.',
  ].join(' '),
  inputSchema: z.object(rangeInput(MAX_RANGE_DAYS)),
  async run(input, context) {
    const zone = await context.timeZone();
    const { start, end } = await resolveRange(input, context, MAX_RANGE_DAYS, 'Days');
    const client = context.client;
    const limit = LIMITS.activitySearchMaxResults;

    const [summaries, sleep, hrv, activities] = await Promise.allSettled([
      getDailySummaries(client, start, end),
      getSleepRange(client, start, end),
      getHrvRange(client, start, end),
      searchActivities(client, { start, end, limit }),
    ]);
    const results = [summaries, sleep, hrv, activities];
    const failed = results.filter((result) => result.status === 'rejected');
    if (failed.length === results.length) throw failed[0]?.reason;

    const byDate = <T>(rows: T[] | undefined, date: (row: T) => string | null | undefined) =>
      new Map((rows ?? []).map((row) => [date(row), row] as const));
    const dailyByDate = byDate(settledValue(summaries), (row) => row.calendarDate);
    const sleepByDate = byDate(
      settledValue(sleep)?.filter(hasSleepData),
      (row) => row.calendarDate,
    );
    const hrvByDate = byDate(settledValue(hrv), (row) => row.calendarDate);
    const activityList = settledValue(activities);
    const activitiesByDate = groupByLocalDate(activityList ?? []);

    const days = [];
    for (let date = start; date <= end; date = addDays(date, 1)) {
      const daily = dailyByDate.get(date);
      const night = sleepByDate.get(date);
      const nightHrv = hrvByDate.get(date);
      const dailyFields = daily ? dailyRow(daily) : undefined;
      const sleepFields = night ? sleepRow(night, zone.timeZone) : undefined;
      const hrvFields = nightHrv ? hrvRow(nightHrv) : undefined;
      days.push({
        date,
        resting_hr_bpm: dailyFields?.resting_hr_bpm ?? null,
        hrv_ms: hrvFields?.last_night_avg_ms ?? null,
        hrv_status: hrvFields?.status ?? null,
        sleep_min: sleepFields?.duration_min ?? null,
        sleep_score: sleepFields?.score ?? null,
        body_battery_max: dailyFields?.body_battery_max ?? null,
        body_battery_charged: dailyFields?.body_battery_charged ?? null,
        stress_avg: dailyFields?.stress_avg ?? null,
        intensity_min_total: dailyFields?.intensity_min_total ?? null,
        steps: dailyFields?.steps ?? null,
        ...(activityList ? activityTotals(activitiesByDate.get(date) ?? []) : {}),
      });
    }

    const warnings = [
      zone.warning,
      settledWarning('Daily summaries', summaries),
      settledWarning('Sleep', sleep),
      settledWarning('HRV', hrv),
      settledWarning('Activities', activities),
      activityList?.length === limit
        ? `${limit} or more activities in the range; activity totals may be incomplete. Use a shorter range.`
        : undefined,
    ].filter((warning): warning is string => Boolean(warning));

    return {
      start_date: start,
      end_date: end,
      time_zone: zone.timeZone,
      days,
      summary: summarize(days, [
        'resting_hr_bpm',
        'hrv_ms',
        'sleep_min',
        'sleep_score',
        'body_battery_max',
        'stress_avg',
        'intensity_min_total',
        'activity_min',
        'training_load',
      ]),
      warnings: warnings.length > 0 ? warnings : null,
    };
  },
});

/** Activities by their own local start date ("YYYY-MM-DD HH:MM:SS" → "YYYY-MM-DD"). */
function groupByLocalDate(activities: ActivitySummary[]): Map<string, ActivitySummary[]> {
  const groups = new Map<string, ActivitySummary[]>();
  for (const activity of activities) {
    const date = activity.startTimeLocal?.slice(0, 10);
    if (!date) continue;
    groups.set(date, [...(groups.get(date) ?? []), activity]);
  }
  return groups;
}

/** Zero rather than null on rest days, so averages are per day. */
function activityTotals(activities: ActivitySummary[]) {
  const sum = (pick: (activity: ActivitySummary) => number | null | undefined) =>
    activities.reduce((total, activity) => total + (pick(activity) ?? 0), 0);
  return {
    activity_count: activities.length,
    activity_min: round(sum((activity) => activity.duration) / 60),
    activity_distance_km: round(sum((activity) => activity.distance) / 1000, 2),
    training_load: round(sum((activity) => activity.activityTrainingLoad)),
  };
}
