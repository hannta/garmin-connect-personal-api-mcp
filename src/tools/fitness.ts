// Single-endpoint tools for fitness age, heart-rate zones and weight goals.

import { z } from 'zod';
import { LIMITS, getFitnessAge, getHeartRateZones, getWeightGoals } from '../garmin/endpoints';
import type { FitnessAge, WeightGoal } from '../garmin/types';
import { gramsToKg, round } from '../lib/units';
import { dateInput, defineTool } from './define';
import { formatHeartRateZones } from './get-profile';
import { rangeInput, resolveRange } from './range';

export const getFitnessAgeTool = defineTool({
  name: 'garmin_get_fitness_age',
  title: 'Get Garmin fitness age',
  description: [
    "Garmin's fitness age on a date, compared with chronological age and the achievable",
    'fitness age, and the components',
    'it is based on: resting heart rate, BMI, and vigorous days and minutes per week.',
    'Components marked stale have no recent data. Garmin does not use VO2max here.',
  ].join(' '),
  inputSchema: z.object({
    date: dateInput("Calendar date, YYYY-MM-DD. Default: today in the user's time zone."),
  }),
  async run(input, context) {
    const date = input.date ?? (await context.today());
    return formatFitnessAge(await getFitnessAge(context.client, date), date);
  },
});

export function formatFitnessAge(fitness: FitnessAge, date: string) {
  if (typeof fitness.fitnessAge !== 'number') {
    const reason = fitness.invalidReason ? ` (${fitness.invalidReason})` : '';
    return { date, no_data: true, note: `Garmin has no fitness age for this date${reason}.` };
  }
  const components = fitness.components ?? {};
  return {
    date,
    fitness_age: round(fitness.fitnessAge, 1),
    chronological_age: fitness.chronologicalAge,
    previous_fitness_age: round(fitness.previousFitnessAge, 1),
    // The lowest fitness age reachable by improving the components.
    achievable_fitness_age: round(fitness.achievableFitnessAge, 1),
    components: {
      resting_hr_bpm: component(components.rhr, 0),
      bmi: component(components.bmi, 1, components.bmi?.lastMeasurementDate),
      vigorous_days_per_week: component(components.vigorousDaysAvg, 1),
      vigorous_min_per_week: component(components.vigorousMinutesAvg, 0),
    },
    last_updated: fitness.lastUpdated?.slice(0, 10),
  };
}

function component(
  value: { value?: number | null; stale?: boolean | null } | null | undefined,
  decimals: number,
  measured?: string | null,
) {
  if (typeof value?.value !== 'number') return null;
  return {
    value: round(value.value, decimals),
    stale: value.stale === true ? true : null,
    measured_date: measured?.slice(0, 10),
  };
}

export const getHeartRateZonesTool = defineTool({
  name: 'garmin_get_heart_rate_zones',
  title: 'Get Garmin heart-rate zones',
  description: [
    "The user's heart-rate zones per sport (bpm ranges for zones 1–5), with the max,",
    'resting and lactate-threshold heart rate and the method they are based on.',
    'garmin_get_profile returns the same zones together with profile settings.',
  ].join(' '),
  inputSchema: z.object({}),
  async run(_input, context) {
    return { heart_rate_zones: formatHeartRateZones(await getHeartRateZones(context.client)) };
  },
});

export const getWeightGoalsTool = defineTool({
  name: 'garmin_get_weight_goals',
  title: 'Get Garmin weight goals',
  description: [
    'Weight goals in effect during a date range: target weight (kg) and start / end date.',
    'For weigh-ins use garmin_get_weight.',
    `Defaults to the last 7 days; at most ${LIMITS.weightGoalRangeDays} days per call.`,
  ].join(' '),
  inputSchema: z.object(rangeInput(LIMITS.weightGoalRangeDays)),
  async run(input, context) {
    const range = await resolveRange(input, context, LIMITS.weightGoalRangeDays, 'Weight goals');
    const response = await getWeightGoals(context.client, range.start, range.end);
    const goals = (response?.userGoals ?? []).map(weightGoal);
    return {
      start_date: range.start,
      end_date: range.end,
      goals,
      no_data: goals.length === 0 ? true : null,
      note: goals.length === 0 ? 'No weight goal set in Garmin Connect for this range.' : null,
    };
  },
});

function weightGoal(goal: WeightGoal) {
  const grams = goal.userGoalType === 'WEIGHT_GRAMS';
  return {
    name: goal.goalName,
    target_kg: grams ? gramsToKg(goal.goalValue) : null,
    // Unknown goal types are passed through with Garmin's own value.
    type: grams ? null : goal.userGoalType,
    value: grams ? null : goal.goalValue,
    start_date: goal.startDate?.slice(0, 10),
    end_date: goal.endDate?.slice(0, 10),
  };
}
