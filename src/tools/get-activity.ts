import { z } from 'zod';
import type { GarminClient } from '../garmin/client';
import { getActivity, searchActivities } from '../garmin/endpoints';
import type { ActivityDetail, ActivitySummary, SummarizedExerciseSet } from '../garmin/types';
import { localIsoFromPair } from '../lib/dates';
import { formatDuration, gramsToKg, metersToKm, round } from '../lib/units';
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
    'change, stamina, temperature, estimated sweat loss, and interval totals by type',
    '(warm-up / active / recovery / cool-down) plus run / walk totals. Strength activities',
    'add sets, reps and weight per exercise category. For per-lap rows, use',
    'garmin_get_activity_laps.',
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
    elevation: {
      gain_m: round(s.elevationGain),
      loss_m: round(s.elevationLoss),
      min_m: round(s.minElevation),
      max_m: round(s.maxElevation),
    },
    heart_rate: {
      avg_bpm: round(s.averageHR),
      max_bpm: round(s.maxHR),
      min_bpm: round(s.minHR),
    },
    time_in_hr_zones: summary ? hrTimeInZones(summary) : null,
    running_dynamics: {
      cadence_spm: round(s.averageRunCadence),
      max_cadence_spm: round(s.maxRunCadence),
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
      aerobic_message: s.aerobicTrainingEffectMessage,
      anaerobic_message: s.anaerobicTrainingEffectMessage,
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
    sweat_loss_ml: round(s.waterEstimated),
    temperature_c: {
      avg: round(s.averageTemperature),
      min: round(s.minTemperature),
      max: round(s.maxTemperature),
    },
    respiration_brpm: {
      avg: round(s.avgRespirationRate),
      min: round(s.minRespirationRate),
      max: round(s.maxRespirationRate),
    },
    // In Garmin's spec but not seen in real data so far; returned when present.
    vo2max: round(summary?.vO2MaxValue, 1),
    lactate_threshold_hr_bpm: round(summary?.lactateThresholdBpm),
    personal_record: detail.metadataDTO?.personalRecord === true || summary?.isPR === true || null,
    strength: summary ? strengthSummary(summary) : null,
    lap_count: lapCount,
    intervals,
    run_walk: splitTotals(detail.splitSummaries, 'RWD_', type),
    note:
      intervals || (lapCount ?? 0) > 1
        ? 'Interval data is totals per type; garmin_get_activity_laps has one row per lap and rep.'
        : null,
    warnings: warnings.length > 0 ? warnings : null,
  };
}

/** Strength totals per exercise category, from activity search. */
export function strengthSummary(summary: ActivitySummary) {
  const exercises = (summary.summarizedExerciseSets ?? []).map((set: SummarizedExerciseSet) => ({
    category: set.category,
    sub_category: set.subCategory,
    sets: set.sets,
    reps: set.reps,
    max_weight_kg: set.maxWeight ? gramsToKg(set.maxWeight) : null,
    volume_kg: set.volume ? gramsToKg(set.volume, 0) : null,
    duration: formatDuration(typeof set.duration === 'number' ? set.duration / 1000 : null),
  }));
  if (exercises.length === 0 && typeof summary.totalSets !== 'number') return null;
  return {
    total_sets: summary.totalSets,
    active_sets: summary.activeSets,
    total_reps: summary.totalReps,
    exercises: exercises.length > 0 ? exercises : null,
  };
}
