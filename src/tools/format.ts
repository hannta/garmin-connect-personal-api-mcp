// Output shaping shared by several tools. Every formatter whitelists the fields it
// returns, so Garmin's location data (start / end coordinates, location names) and owner
// details never reach the output.

import type { ActivitySummary, SplitSummary } from '../garmin/types';
import { localIsoFromPair } from '../lib/dates';
import {
  formatDuration,
  metersToKm,
  round,
  speedToKmh,
  speedToPace,
  speedToPacePer100m,
} from '../lib/units';

type Maybe = number | null | undefined;

const FOOT_TYPES = /running|walking|hiking|track|treadmill|trail|ultra|mountaineering/;

/** Pace for running / walking, min/100 m for swimming, km/h for everything else. */
export function paceOrSpeed(typeKey: string | null | undefined, speed: Maybe, prefix = '') {
  const key = typeKey ?? '';
  if (key.includes('swim')) return { [`${prefix}pace_min_per_100m`]: speedToPacePer100m(speed) };
  if (FOOT_TYPES.test(key)) return { [`${prefix}pace_min_per_km`]: speedToPace(speed) };
  return { [`${prefix}speed_kmh`]: speedToKmh(speed) };
}

export function durationFields(seconds: Maybe, prefix = 'duration') {
  return { [prefix]: formatDuration(seconds), [`${prefix}_s`]: round(seconds) };
}

/** One compact row per activity, for lists. */
export function activityRow(activity: ActivitySummary) {
  const type = activity.activityType?.typeKey;
  return {
    id: activity.activityId,
    name: activity.activityName,
    type,
    start_local: localIsoFromPair(activity.startTimeLocal, activity.startTimeGMT),
    distance_km: metersToKm(activity.distance),
    ...durationFields(activity.duration),
    ...paceOrSpeed(type, activity.averageSpeed),
    avg_hr_bpm: round(activity.averageHR),
    max_hr_bpm: round(activity.maxHR),
    elevation_gain_m: round(activity.elevationGain),
    training_effect: {
      aerobic: round(activity.aerobicTrainingEffect, 1),
      anaerobic: round(activity.anaerobicTrainingEffect, 1),
      label: activity.trainingEffectLabel,
    },
    training_load: round(activity.activityTrainingLoad),
  };
}

/** Time per zone with its share of the total; null when Garmin has no zone data. */
export function timeInZones(seconds: Maybe[]) {
  const total = seconds.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  if (total <= 0) return null;
  return seconds.map((value, index) => ({
    zone: index + 1,
    ...durationFields(value ?? 0),
    percent: round(((value ?? 0) / total) * 100),
  }));
}

export function hrTimeInZones(activity: ActivitySummary) {
  return timeInZones([
    activity.hrTimeInZone_1,
    activity.hrTimeInZone_2,
    activity.hrTimeInZone_3,
    activity.hrTimeInZone_4,
    activity.hrTimeInZone_5,
  ]);
}

export function powerTimeInZones(activity: ActivitySummary) {
  return timeInZones([
    activity.powerTimeInZone_1,
    activity.powerTimeInZone_2,
    activity.powerTimeInZone_3,
    activity.powerTimeInZone_4,
    activity.powerTimeInZone_5,
  ]);
}

const SPLIT_NAMES: Record<string, string> = {
  INTERVAL_WARMUP: 'warmup',
  INTERVAL_ACTIVE: 'active',
  INTERVAL_RECOVERY: 'recovery',
  INTERVAL_REST: 'rest',
  INTERVAL_COOLDOWN: 'cooldown',
  RWD_RUN: 'run',
  RWD_WALK: 'walk',
  RWD_STAND: 'stand',
};

const SPLIT_ORDER = Object.keys(SPLIT_NAMES);

function splitOrder(splitType: string | null | undefined): number {
  const index = SPLIT_ORDER.indexOf(splitType ?? '');
  return index === -1 ? SPLIT_ORDER.length : index;
}

/** Totals per split type (`splitSummaries`): one entry per type, not per lap. */
export function splitTotals(
  splits: SplitSummary[] | null | undefined,
  prefix: 'INTERVAL_' | 'RWD_',
  typeKey: string | null | undefined,
) {
  const rows = (splits ?? [])
    .filter((split) => split.splitType?.startsWith(prefix))
    .sort((a, b) => splitOrder(a.splitType) - splitOrder(b.splitType))
    .map((split) => ({
      type: SPLIT_NAMES[split.splitType ?? ''] ?? split.splitType?.toLowerCase(),
      count: split.noOfSplits,
      distance_km: metersToKm(split.distance),
      ...durationFields(split.duration),
      ...paceOrSpeed(typeKey, split.averageSpeed, 'avg_'),
      ...paceOrSpeed(typeKey, split.avgGradeAdjustedSpeed, 'avg_grade_adjusted_'),
      avg_hr_bpm: round(split.averageHR),
      max_hr_bpm: round(split.maxHR),
      avg_power_w: round(split.averagePower),
      avg_cadence_spm: round(split.averageRunCadence),
    }));
  return rows.length > 0 ? rows : null;
}
