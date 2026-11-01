import { z } from 'zod';
import type { GarminClient } from '../garmin/client';
import { getActivity, searchActivities } from '../garmin/endpoints';
import type { ActivityDetail, ActivitySummary } from '../garmin/types';
import { localIsoFromPair } from '../lib/dates';
import { metersToKm, round } from '../lib/units';
import { defineTool } from './define';
import {
  durationFields,
  hrTimeInZones,
  paceOrSpeed,
  powerTimeInZones,
  splitTotals,
} from './format';

const FEEL: Record<number, string> = {
  0: 'very weak',
  25: 'weak',
  50: 'normal',
  75: 'strong',
  100: 'very strong',
};

export const getActivityTool = defineTool({
  name: 'garmin_get_activity',
  title: 'Get a Garmin activity',
  description: [
    'Full summary of one Garmin activity: pace and grade-adjusted pace, heart rate and',
    'time in HR zones, running dynamics (cadence, ground contact time, vertical',
    'oscillation, stride), power, training effect and load, RPE and feel, Body Battery',
    'change, stamina, and interval totals by type (warm-up / active / recovery / cool-down)',
    'plus run / walk totals. Per-lap rows are not available.',
    'Find the id with garmin_search_activities or garmin_get_day.',
  ].join(' '),
  inputSchema: z.object({
    activity_id: z.number().int().positive().describe('Garmin activity ID.'),
  }),
  async run(input, context) {
    const detail = await getActivity(context.client, input.activity_id);
    const warnings: string[] = [];
    const summary = await findInSearch(context.client, detail).catch(() => {
      warnings.push('Time in heart-rate and power zones is unavailable (activity search failed).');
      return undefined;
    });
    return formatActivity(detail, summary, warnings);
  },
});

/** HR / power zone times are only in activity search, so look the activity up by date. */
async function findInSearch(
  client: GarminClient,
  detail: ActivityDetail,
): Promise<ActivitySummary | undefined> {
  const date = detail.summaryDTO?.startTimeLocal?.slice(0, 10);
  if (!date) return undefined;
  const activities = await searchActivities(client, { start: date, end: date, limit: 100 });
  return activities.find((activity) => activity.activityId === detail.activityId);
}

export function formatActivity(
  detail: ActivityDetail,
  summary: ActivitySummary | undefined,
  warnings: string[] = [],
) {
  const s = detail.summaryDTO ?? {};
  const type = detail.activityTypeDTO?.typeKey;
  const rpe = s.directWorkoutRpe;
  const feel = s.directWorkoutFeel;
  const intervals = splitTotals(detail.splitSummaries, 'INTERVAL_', type);
  const lapCount = detail.metadataDTO?.lapCount;
  return {
    id: detail.activityId,
    name: detail.activityName,
    description: detail.description,
    type,
    start_local: localIsoFromPair(s.startTimeLocal, s.startTimeGMT),
    time_zone: detail.timeZoneUnitDTO?.timeZone,
    distance_km: metersToKm(s.distance),
    ...durationFields(s.duration),
    ...durationFields(s.movingDuration, 'moving_duration'),
    ...durationFields(s.elapsedDuration, 'elapsed_duration'),
    ...paceOrSpeed(type, s.averageSpeed, 'avg_'),
    ...paceOrSpeed(type, s.avgGradeAdjustedSpeed, 'avg_grade_adjusted_'),
    ...paceOrSpeed(type, s.averageMovingSpeed, 'avg_moving_'),
    ...paceOrSpeed(type, s.maxSpeed, 'max_'),
    elevation: { gain_m: round(s.elevationGain), loss_m: round(s.elevationLoss) },
    heart_rate: {
      avg_bpm: round(s.averageHR),
      max_bpm: round(s.maxHR),
      min_bpm: round(s.minHR),
    },
    time_in_hr_zones: summary ? hrTimeInZones(summary) : null,
    running_dynamics: {
      cadence_spm: round(s.averageRunCadence),
      ground_contact_time_ms: round(s.groundContactTime),
      stride_length_cm: round(s.strideLength),
      vertical_oscillation_cm: round(s.verticalOscillation, 1),
      vertical_ratio_pct: round(s.verticalRatio, 1),
    },
    power: {
      avg_w: round(s.averagePower),
      normalized_w: round(s.normalizedPower),
      max_w: round(s.maxPower),
    },
    time_in_power_zones: summary ? powerTimeInZones(summary) : null,
    training_effect: {
      aerobic: round(s.trainingEffect, 1),
      anaerobic: round(s.anaerobicTrainingEffect, 1),
      label: s.trainingEffectLabel,
    },
    training_load: round(s.activityTrainingLoad),
    perceived: {
      rpe: typeof rpe === 'number' ? round(rpe / 10) : null,
      feel: typeof feel === 'number' ? (FEEL[feel] ?? null) : null,
    },
    intensity_minutes: {
      moderate: s.moderateIntensityMinutes,
      vigorous: s.vigorousIntensityMinutes,
    },
    body_battery_change: s.differenceBodyBattery,
    stamina_pct: {
      start: round(s.beginPotentialStamina),
      end: round(s.endPotentialStamina),
      min_available: round(s.minAvailableStamina),
    },
    calories_kcal: round(s.calories),
    avg_temperature_c: round(s.averageTemperature),
    avg_respiration_brpm: round(s.avgRespirationRate),
    lap_count: lapCount,
    intervals,
    run_walk: splitTotals(detail.splitSummaries, 'RWD_', type),
    note:
      intervals || (lapCount ?? 0) > 1
        ? 'Interval data is totals per type; per-lap rows are not available.'
        : null,
    warnings: warnings.length > 0 ? warnings : null,
  };
}
