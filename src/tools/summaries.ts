// Range tools that mirror Garmin's range endpoints: one row per day (or night) with
// numeric, unit-suffixed fields that Claude can compare across days, plus `summary`
// statistics. Each tool call is exactly one Garmin request.

import { z } from 'zod';
import { getDailySummaries, getHrvRange, getSleepRange } from '../garmin/endpoints';
import type { DailySleep, DailySummary, HrvSummary } from '../garmin/types';
import { garminGmtToLocalIso } from '../lib/dates';
import { formatHoursMinutes, round } from '../lib/units';
import { defineTool } from './define';
import { hasSleepData } from './get-sleep';
import { rangeInput, resolveRange, summarize } from './range';

type Maybe = number | null | undefined;

export const MAX_DAYS = {
  dailySummaries: 92,
  sleep: 31,
  hrv: 92,
} as const;

/** Garmin reports "no data" as 0 for heart rate and respiration. */
export function positive(value: Maybe): number | null {
  return typeof value === 'number' && value > 0 ? value : null;
}

/** Garmin reports "not enough data" as negative stress values. */
export function nonNegative(value: Maybe): number | null {
  return typeof value === 'number' && value >= 0 ? value : null;
}

export function minutes(seconds: Maybe): number | null {
  return typeof seconds === 'number' ? round(seconds / 60) : null;
}

export function dailyRow(summary: DailySummary) {
  const moderate = summary.intensityMinutes?.moderate;
  const vigorous = summary.intensityMinutes?.vigorous;
  return {
    date: summary.calendarDate,
    resting_hr_bpm: positive(summary.heartRate?.restingValue),
    min_hr_bpm: positive(summary.heartRate?.minValue),
    max_hr_bpm: positive(summary.heartRate?.maxValue),
    body_battery_max: summary.bodyBattery?.maxValue ?? null,
    body_battery_min: summary.bodyBattery?.minValue ?? null,
    body_battery_charged: summary.bodyBattery?.chargedValue ?? null,
    body_battery_drained: summary.bodyBattery?.drainedValue ?? null,
    stress_avg: nonNegative(summary.stress?.avgLevel),
    stress_max: nonNegative(summary.stress?.maxLevel),
    intensity_min_moderate: moderate ?? null,
    intensity_min_vigorous: vigorous ?? null,
    // Garmin counts vigorous minutes double toward the weekly goal.
    intensity_min_total:
      typeof moderate === 'number' && typeof vigorous === 'number' ? moderate + 2 * vigorous : null,
    steps: summary.movement?.steps?.value ?? null,
    calories_total_kcal: positive(summary.calories?.burnedTotal),
    calories_active_kcal: summary.calories?.burnedActive ?? null,
    respiration_avg_brpm: round(positive(summary.respiration?.avgValue), 1),
  };
}

export function sleepRow(sleep: DailySleep, timeZone: string) {
  const clock = (value: Maybe) => garminGmtToLocalIso(value, timeZone)?.slice(11, 16) ?? null;
  return {
    date: sleep.calendarDate ?? null,
    bedtime: clock(sleep.sleepStartTimestampGMT),
    wake_time: clock(sleep.sleepEndTimestampGMT),
    duration: formatHoursMinutes(sleep.sleepTimeSeconds),
    duration_min: minutes(sleep.sleepTimeSeconds),
    score: sleep.sleepScores?.overall?.value ?? null,
    qualifier: sleep.sleepScores?.overall?.qualifierKey ?? null,
    deep_min: minutes(sleep.deepSleepSeconds),
    light_min: minutes(sleep.lightSleepSeconds),
    rem_min: minutes(sleep.remSleepSeconds),
    awake_min: minutes(sleep.awakeSleepSeconds),
    awake_count: sleep.awakeCount ?? null,
    nap_min: minutes(sleep.napTimeSeconds) || null,
    avg_hr_bpm: round(positive(sleep.avgHeartRate)),
    avg_respiration_brpm: round(positive(sleep.averageRespirationValue), 1),
    avg_spo2_pct: round(positive(sleep.averageSpO2Value)),
    avg_sleep_stress: round(nonNegative(sleep.avgSleepStress)),
    // sleepNeed is in minutes; `actual` includes Garmin's adjustments for training and sleep debt.
    sleep_need_min: sleep.sleepNeed?.actual ?? null,
    breathing_disruptions: sleep.breathingDisruptionSeverity ?? null,
  };
}

export function hrvRow(summary: HrvSummary) {
  return {
    date: summary.calendarDate,
    last_night_avg_ms: summary.lastNightAvg ?? null,
    last_night_5min_high_ms: summary.lastNight5MinHigh ?? null,
    weekly_avg_ms: summary.weeklyAvg ?? null,
    baseline_low_ms: summary.baseline?.balancedLow ?? null,
    baseline_high_ms: summary.baseline?.balancedUpper ?? null,
    status: summary.status ?? null,
  };
}

export const getDailySummariesTool = defineTool({
  name: 'garmin_get_daily_summaries',
  title: 'Get Garmin daily summaries',
  description: [
    'All-day wellness per day over a date range, for trends: resting / min / max heart',
    'rate, Body Battery (max, min, charged, drained), average and max stress, intensity',
    'minutes, steps, calories burned (total / active) and respiration, plus average / min /',
    'max of each field in `summary`.',
    `Defaults to the last 7 days; at most ${MAX_DAYS.dailySummaries} days per call.`,
    "Today's row is partial. For sleep and HRV over a range use garmin_get_sleep_summaries",
    'and garmin_get_hrv_summaries, or garmin_get_days for everything per day.',
  ].join(' '),
  inputSchema: z.object(rangeInput(MAX_DAYS.dailySummaries)),
  async run(input, context) {
    const zone = await context.timeZone();
    const range = await resolveRange(input, context, MAX_DAYS.dailySummaries, 'Daily summaries');
    const days = (await getDailySummaries(context.client, range.start, range.end)).map(dailyRow);
    return {
      start_date: range.start,
      end_date: range.end,
      time_zone: zone.timeZone,
      days,
      summary: summarize(days, [
        'resting_hr_bpm',
        'body_battery_max',
        'body_battery_charged',
        'stress_avg',
        'intensity_min_total',
        'steps',
        'respiration_avg_brpm',
      ]),
      warning: zone.warning,
    };
  },
});

export const getSleepSummariesTool = defineTool({
  name: 'garmin_get_sleep_summaries',
  title: 'Get Garmin sleep summaries',
  description: [
    'Sleep per night over a date range, for trends: bedtime and wake time, duration,',
    'sleep score, deep / light / REM / awake minutes, nap minutes, average heart rate,',
    "respiration, SpO2, sleep stress, breathing disruptions and Garmin's sleep need, plus",
    'average / min / max in `summary`.',
    'Nights are keyed by the wake-up date.',
    `Defaults to the last 7 nights; at most ${MAX_DAYS.sleep} nights per call (Garmin's limit).`,
    'For one night in full detail use garmin_get_sleep.',
  ].join(' '),
  inputSchema: z.object(rangeInput(MAX_DAYS.sleep)),
  async run(input, context) {
    const zone = await context.timeZone();
    const range = await resolveRange(input, context, MAX_DAYS.sleep, 'Sleep summaries');
    const sleeps = await getSleepRange(context.client, range.start, range.end);
    const nights = sleeps.filter(hasSleepData).map((sleep) => sleepRow(sleep, zone.timeZone));
    return {
      start_date: range.start,
      end_date: range.end,
      time_zone: zone.timeZone,
      nights,
      summary: summarize(nights, [
        'duration_min',
        'score',
        'deep_min',
        'rem_min',
        'awake_min',
        'avg_hr_bpm',
        'avg_respiration_brpm',
        'avg_sleep_stress',
        'sleep_need_min',
      ]),
      warning: zone.warning,
    };
  },
});

export const getHrvSummariesTool = defineTool({
  name: 'garmin_get_hrv_summaries',
  title: 'Get Garmin HRV summaries',
  description: [
    'Overnight heart-rate variability per night over a date range, for trends:',
    'last-night average, 5-minute high, 7-day average, personal baseline range and HRV',
    'status (BALANCED, UNBALANCED, LOW, POOR), plus average / min / max in `summary`.',
    'Keyed by the wake-up date; HRV in milliseconds (RMSSD).',
    `Defaults to the last 7 nights; at most ${MAX_DAYS.hrv} nights per call.`,
    'For one night with overnight readings use garmin_get_hrv.',
  ].join(' '),
  inputSchema: z.object(rangeInput(MAX_DAYS.hrv)),
  async run(input, context) {
    const zone = await context.timeZone();
    const range = await resolveRange(input, context, MAX_DAYS.hrv, 'HRV summaries');
    const nights = (await getHrvRange(context.client, range.start, range.end)).map(hrvRow);
    return {
      start_date: range.start,
      end_date: range.end,
      time_zone: zone.timeZone,
      nights,
      summary: summarize(nights, ['last_night_avg_ms', 'weekly_avg_ms']),
      warning: zone.warning,
    };
  },
});
