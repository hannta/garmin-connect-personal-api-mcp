// The structured workout an activity was started from, decoded from Garmin's encodings
// (documented in its OpenAPI spec): heart rate is a percentage of max HR, or bpm + 100;
// power is a percentage of FTP, or watts + 1000; speed is m/s; a non-zero target value
// selects a zone instead of a custom range. No data on the owner's account.

import { z } from 'zod';
import { getActivityWorkouts } from '../garmin/endpoints';
import type { ActivityWorkout, WorkoutStep } from '../garmin/types';
import { formatDuration, round, speedToKmh, speedToPace, speedToPacePer100m } from '../lib/units';
import { defineTool } from './define';

type Maybe = number | null | undefined;

const HR_BPM_OFFSET = 100;
const POWER_WATTS_OFFSET = 1000;

/** { hr_bpm } or { hr_pct_max } for one encoded heart-rate value. */
function heartRate(value: number): Record<string, number> {
  return value > HR_BPM_OFFSET ? { hr_bpm: value - HR_BPM_OFFSET } : { hr_pct_max: value };
}

function power(value: number): Record<string, number> {
  return value > POWER_WATTS_OFFSET
    ? { power_w: value - POWER_WATTS_OFFSET }
    : { power_pct_ftp: value };
}

/** Two encoded values as one range per unit, e.g. { hr_bpm: [150, 170] }. */
function range(low: number, high: number, decode: (value: number) => Record<string, number>) {
  const from = decode(low);
  const to = decode(high);
  const [key] = Object.keys(from);
  if (key === undefined || Object.keys(to)[0] !== key) {
    return { from, to }; // mixed encodings; keep both as they are
  }
  return { [key]: [from[key], to[key]] };
}

function speedRange(sport: string, low: number, high: number) {
  if (sport === 'cycling') return { speed_kmh: [speedToKmh(low), speedToKmh(high)] };
  if (sport === 'swimming') {
    return { pace_min_per_100m: [speedToPacePer100m(high), speedToPacePer100m(low)] };
  }
  // Fastest pace first.
  return { pace_min_per_km: [speedToPace(high), speedToPace(low)] };
}

function target(step: WorkoutStep, sport: string) {
  const type = step.targetType ?? 'OPEN';
  const zone = step.targetValue;
  const low = step.targetValueLow;
  const high = step.targetValueHigh;
  const hasZone = typeof zone === 'number' && zone > 0;
  const hasRange = typeof low === 'number' && typeof high === 'number';
  switch (type) {
    case 'OPEN':
    case 'NO_TARGET':
      return null;
    case 'HEART_RATE':
      if (hasZone) return { hr_zone: zone };
      return hasRange ? range(low, high, heartRate) : null;
    case 'POWER':
      if (hasZone) return { power_zone: zone };
      return hasRange ? range(low, high, power) : null;
    case 'SPEED':
    case 'PACE':
      if (hasZone) return { speed_zone: zone };
      return hasRange ? speedRange(sport, low, high) : null;
    case 'CADENCE':
      if (hasZone) return { cadence_zone: zone };
      if (!hasRange) return null;
      return sport === 'cycling' ? { cadence_rpm: [low, high] } : { cadence_spm: [low, high] };
    default:
      // e.g. SWIM_STROKE: Garmin's own selector values.
      return { type: type.toLowerCase(), value: zone, low, high };
  }
}

/** How the step ends: time, distance, reps, a heart-rate or power threshold, or lap. */
function end(step: WorkoutStep) {
  const type = step.durationType ?? 'OPEN';
  const value: Maybe = step.durationValue;
  if (typeof value !== 'number')
    return { ends: type === 'OPEN' ? 'lap_button' : type.toLowerCase() };
  switch (type) {
    case 'TIME':
      return { ends: 'time', duration: formatDuration(value), duration_s: round(value) };
    case 'DISTANCE':
      return { ends: 'distance', distance_m: round(value) };
    case 'REPS':
      return { ends: 'reps', reps: value };
    case 'CALORIES':
      return { ends: 'calories', calories_kcal: value };
    case 'HR_LESS_THAN':
      return { ends: 'hr_below', ...heartRate(value) };
    case 'HR_GREATER_THAN':
      return { ends: 'hr_above', ...heartRate(value) };
    case 'POWER_LESS_THAN':
      return { ends: 'power_below', ...power(value) };
    case 'POWER_GREATER_THAN':
      return { ends: 'power_above', ...power(value) };
    case 'OPEN':
      return { ends: 'lap_button' };
    default:
      return { ends: type.toLowerCase(), value };
  }
}

/** Repeat instruction: go back to `back_to_step` until done. */
function repeat(step: WorkoutStep) {
  const type = step.durationType ?? '';
  const until = type.replace('REPEAT_UNTIL_', '');
  const value = step.targetValue;
  const base = { back_to_step: step.durationValue };
  switch (until) {
    case 'STEPS_CMPLT':
      return { ...base, times: value };
    case 'TIME':
      return { ...base, until: 'time', until_s: value };
    case 'DISTANCE':
      return { ...base, until: 'distance', until_m: value };
    default:
      return { ...base, until: until.toLowerCase(), until_value: value };
  }
}

export function formatStep(step: WorkoutStep, sport: string) {
  const common = { step: step.stepIndex, name: step.name, notes: step.notes };
  if (step.durationType?.startsWith('REPEAT')) {
    return { ...common, type: 'repeat', repeat: repeat(step) };
  }
  return {
    ...common,
    type: step.intensity?.toLowerCase(),
    ...end(step),
    target: target(step, sport),
    exercise:
      step.exerciseName || step.exerciseCategory
        ? { category: step.exerciseCategory, name: step.exerciseName }
        : null,
    weight_kg: round(step.exerciseWeightValue, 1),
    equipment: step.equipmentType === 'NONE' ? null : step.equipmentType?.toLowerCase(),
  };
}

export function formatWorkout(workout: ActivityWorkout) {
  const sport = workout.sport?.toLowerCase() ?? '';
  return {
    name: workout.workoutName,
    sport: sport || null,
    created: workout.timeCreated?.slice(0, 10),
    coaching_phrase: workout.workoutPhrase,
    steps: (workout.steps ?? [])
      .slice()
      .sort((a, b) => (a.stepIndex ?? 0) - (b.stepIndex ?? 0))
      .map((step) => formatStep(step, sport)),
  };
}

export const getActivityWorkoutsTool = defineTool({
  name: 'garmin_get_activity_workouts',
  title: 'Get Garmin activity workout',
  description: [
    'The structured workout an activity was started from, step by step: warm-up / active /',
    'rest, how each step ends (time, distance in m, reps, heart rate or lap button), its',
    'target (HR zone or bpm / % of max HR range, pace range, power, cadence) and repeat',
    'groups (`back_to_step`, `times`). Compare with garmin_get_activity for planned vs.',
    'actual. Empty for activities not started from a workout created in Garmin Connect.',
    'Get the activity id from garmin_search_activities.',
  ].join(' '),
  inputSchema: z.object({
    activity_id: z.number().int().positive().describe('Garmin activity ID.'),
  }),
  async run(input, context) {
    const workouts = (await getActivityWorkouts(context.client, input.activity_id)) ?? [];
    if (workouts.length === 0) {
      return {
        activity_id: input.activity_id,
        no_data: true,
        note: 'This activity was not started from a structured workout.',
      };
    }
    return {
      activity_id: input.activity_id,
      workouts: workouts
        .slice()
        .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
        .map(formatWorkout),
    };
  },
});
