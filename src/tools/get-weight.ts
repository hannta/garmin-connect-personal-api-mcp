import { z } from 'zod';
import { LIMITS, getWeightRange } from '../garmin/endpoints';
import type { DailyWeightSummary, WeightMeasurement } from '../garmin/types';
import { gramsToKg, round } from '../lib/units';
import { defineTool } from './define';
import { rangeInput, resolveRange, summarize } from './range';

const MAX_RANGE_DAYS = LIMITS.weightRangeDays;

export const getWeightTool = defineTool({
  name: 'garmin_get_weight',
  title: 'Get Garmin weight',
  description: [
    'Weigh-ins over a date range, one row per day with a weigh-in: weight and, from',
    'smart scales, BMI, body fat, body water, muscle and bone mass (kg / %).',
    '`summary` has average / min / max weight and the change from the first to the last',
    'weigh-in; `previous_weigh_in` is the last one before the range.',
    `Defaults to the last 7 days; at most ${MAX_RANGE_DAYS} days per call.`,
  ].join(' '),
  inputSchema: z.object(rangeInput(MAX_RANGE_DAYS)),
  async run(input, context) {
    const zone = await context.timeZone();
    const range = await resolveRange(input, context, MAX_RANGE_DAYS, 'Weight');
    const response = await getWeightRange(context.client, range.start, range.end);
    const days = (response.dailyWeightSummaries ?? [])
      .filter((day) => typeof day.latestWeight?.weight === 'number')
      .sort((a, b) => a.summaryDate.localeCompare(b.summaryDate))
      .map(weightRow);
    const first = days[0]?.weight_kg;
    const last = days.at(-1)?.weight_kg;
    const previous = response.previousDateWeight;
    return {
      start_date: range.start,
      end_date: range.end,
      time_zone: zone.timeZone,
      days,
      summary: {
        ...summarize(days, ['weight_kg', 'body_fat_pct']),
        change_kg:
          typeof first === 'number' && typeof last === 'number' && days.length > 1
            ? round(last - first, 1)
            : null,
      },
      previous_weigh_in:
        typeof previous?.weight === 'number'
          ? { date: previous.calendarDate, weight_kg: gramsToKg(previous.weight) }
          : null,
      warning: zone.warning,
    };
  },
});

function weightRow(day: DailyWeightSummary) {
  const latest: WeightMeasurement = day.latestWeight ?? {};
  const entries = day.numOfWeightEntries ?? 1;
  return {
    date: day.summaryDate,
    weight_kg: gramsToKg(latest.weight),
    // Only when the day had several weigh-ins; weight_kg is the latest.
    weight_min_kg: entries > 1 ? gramsToKg(day.minWeight) : null,
    weight_max_kg: entries > 1 ? gramsToKg(day.maxWeight) : null,
    bmi: round(latest.bmi, 1),
    body_fat_pct: round(latest.bodyFat, 1),
    body_water_pct: round(latest.bodyWater, 1),
    muscle_mass_kg: gramsToKg(latest.muscleMass),
    bone_mass_kg: gramsToKg(latest.boneMass),
  };
}
