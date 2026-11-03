// Wellness activities (e.g. breathwork, health snapshots) — separate from regular
// activities. No data on the owner's account, so the formatting follows Garmin's
// OpenAPI spec.

import { z } from 'zod';
import { getWellnessActivities } from '../garmin/endpoints';
import type { WellnessActivitySummary } from '../garmin/types';
import { garminDate, garminTimestampToLocalIso } from '../lib/dates';
import { formatDuration, round } from '../lib/units';
import { defineTool } from './define';
import { rangeInput, resolveRange } from './range';
import { minutes } from './summaries';

const MAX_DAYS = 92;

/** Output name for each of Garmin's summary types, with its unit. */
const METRICS: Record<string, string> = {
  HEART_RATE: 'hr_bpm',
  WRIST_HEART_RATE: 'wrist_hr_bpm',
  STRESS: 'stress',
  RESPIRATION: 'respiration_brpm',
  SPO2: 'spo2_pct',
  RMSSD_HRV: 'hrv_rmssd_ms',
  SDRR_HRV: 'hrv_sdrr_ms',
};

function activityRow(activity: WellnessActivitySummary, timeZone: string) {
  const start = garminTimestampToLocalIso(
    activity.startTimestampLocal,
    activity.startTimestampGMT,
    timeZone,
  );
  const end = garminTimestampToLocalIso(
    activity.endTimestampLocal,
    activity.endTimestampGMT,
    timeZone,
  );
  const seconds =
    start && end ? (new Date(end).getTime() - new Date(start).getTime()) / 1000 : null;
  const metrics = Object.fromEntries(
    (activity.summaryTypeDataList ?? []).map((item) => [
      METRICS[item.summaryType ?? ''] ?? item.summaryType?.toLowerCase() ?? 'unknown',
      { avg: round(item.avgValue, 1), min: round(item.minValue, 1), max: round(item.maxValue, 1) },
    ]),
  );
  const zones = (activity.timeInZoneList ?? []).map((zone) => ({
    zone: zone.zoneNumber,
    from: zone.zoneLowBoundary,
    minutes: minutes(typeof zone.millisInZone === 'number' ? zone.millisInZone / 1000 : null),
  }));
  return {
    date: garminDate(activity.calendarDate) ?? start?.slice(0, 10),
    name: activity.activityName,
    type: activity.wellnessActivityType?.toLowerCase(),
    start,
    end,
    duration: formatDuration(seconds),
    notes: activity.notes,
    metrics: Object.keys(metrics).length > 0 ? metrics : null,
    time_in_zones: zones.length > 0 ? zones : null,
  };
}

export const getWellnessActivitiesTool = defineTool({
  name: 'garmin_get_wellness_activities',
  title: 'Get Garmin wellness activities',
  description: [
    'Wellness activities over a date range — sessions such as breathwork or Health',
    'Snapshot recorded on the watch, separate from regular activities',
    '(garmin_search_activities) — with start / end time, and average / min / max heart',
    'rate, stress, respiration, SpO2 and HRV (RMSSD / SDRR, ms) when recorded, plus time in',
    `zones. Defaults to the last 7 days; at most ${MAX_DAYS} days per call.`,
  ].join(' '),
  inputSchema: z.object(rangeInput(MAX_DAYS)),
  async run(input, context) {
    const zone = await context.timeZone();
    const range = await resolveRange(input, context, MAX_DAYS, 'Wellness activities');
    const activities = ((await getWellnessActivities(context.client, range.start, range.end)) ?? [])
      .map((activity) => activityRow(activity, zone.timeZone))
      .sort((a, b) => String(a.start ?? a.date).localeCompare(String(b.start ?? b.date)));
    if (activities.length === 0) {
      return {
        start_date: range.start,
        end_date: range.end,
        no_data: true,
        note: 'No wellness activities in this range.',
      };
    }
    return {
      start_date: range.start,
      end_date: range.end,
      time_zone: zone.timeZone,
      activities,
      warning: zone.warning,
    };
  },
});
