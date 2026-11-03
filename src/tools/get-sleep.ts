import { z } from 'zod';
import { getSleep } from '../garmin/endpoints';
import { GarminError } from '../garmin/errors';
import type { DailyNap, DailySleep, SleepNeed, SleepScoreItem } from '../garmin/types';
import { garminGmtToLocalIso, localIsoFromOffset } from '../lib/dates';
import { formatHoursMinutes, round } from '../lib/units';
import { dateInput, defineTool } from './define';

export const getSleepTool = defineTool({
  name: 'garmin_get_sleep',
  title: 'Get Garmin sleep',
  description: [
    'One night of sleep from Garmin: start and end time, total sleep, stages',
    "(deep / light / REM / awake), sleep score with each component's optimal range, sleep",
    'need with the reasons Garmin adjusted it (training, sleep history, HRV, naps), the next',
    "night's sleep need, naps that day, average heart rate, respiration, SpO2, sleep stress",
    'and breathing disruptions.',
    'Nights are keyed by the wake-up date: "last night" is today\'s date.',
  ].join(' '),
  inputSchema: z.object({
    date: dateInput(
      "Wake-up date (the morning the night ended), YYYY-MM-DD. Default: today in the user's time zone.",
    ),
  }),
  async run(input, context) {
    const zone = await context.timeZone();
    const date = input.date ?? (await context.today());
    const sleep = await getSleep(context.client, date).catch((error: unknown) => {
      if (error instanceof GarminError && error.code === 'not_found') return null;
      throw error;
    });
    return { ...formatSleep(sleep, date, zone.timeZone), warning: zone.warning };
  },
});

export function hasSleepData(sleep: DailySleep | null): sleep is DailySleep {
  return typeof sleep?.sleepTimeSeconds === 'number' && sleep.sleepTimeSeconds > 0;
}

function stage(seconds: number | null | undefined, total: number) {
  return {
    duration: formatHoursMinutes(seconds),
    minutes: typeof seconds === 'number' ? round(seconds / 60) : null,
    percent: typeof seconds === 'number' && total > 0 ? round((seconds / total) * 100) : null,
  };
}

type ScoreUnit = 'duration' | 'percent' | 'plain';

/** A score component with its optimal range, e.g. REM { value: 19, optimal_pct: [21, 31] }. */
function score(item: SleepScoreItem | null | undefined, unit: ScoreUnit = 'plain') {
  if (!item) return null;
  const { optimalStart: start, optimalEnd: end } = item;
  const hasRange = typeof start === 'number' && typeof end === 'number';
  // A range whose ends are equal (e.g. the total-duration target) is one value.
  const optimal = <T>(format: (value: number) => T) =>
    hasRange ? (start === end ? format(start) : [format(start), format(end)]) : null;
  return {
    value: item.value,
    qualifier: item.qualifierKey,
    optimal: unit === 'plain' ? optimal((value) => round(value, 1)) : null,
    optimal_pct: unit === 'percent' ? optimal((value) => round(value)) : null,
    optimal_duration: unit === 'duration' ? optimal((value) => formatHoursMinutes(value)) : null,
  };
}

const NO_CHANGE = new Set(['NO_CHANGE', 'NONE']);
const pad = (value: number) => String(value).padStart(2, '0');

/** Sleep need (minutes) and what changed it; unchanged reasons are left out. */
export function sleepNeed(need: SleepNeed | null | undefined) {
  if (typeof need?.actual !== 'number') return null;
  const reason = (value: string | null | undefined) =>
    value && !NO_CHANGE.has(value) ? value : null;
  const clock = (minutes: number | null | undefined) =>
    typeof minutes === 'number'
      ? `${pad(Math.floor(minutes / 60) % 24)}:${pad(Math.round(minutes % 60))}`
      : null;
  const bedtime = [clock(need.recommendedBedtimeStartMins), clock(need.recommendedBedtimeEndMins)];
  return {
    baseline: formatHoursMinutes((need.baseline ?? Number.NaN) * 60),
    adjusted: formatHoursMinutes(need.actual * 60),
    adjusted_min: need.actual,
    feedback: need.feedback,
    adjusted_for: {
      training: reason(need.trainingFeedback),
      sleep_history: reason(need.sleepHistoryAdjustment),
      hrv: reason(need.hrvAdjustment),
      naps: reason(need.napAdjustment),
    },
    recommended_bedtime: bedtime.every(Boolean) ? bedtime : null,
  };
}

export function formatNap(nap: DailyNap) {
  const offsetMs =
    typeof nap.napStartTimeOffset === 'number' ? nap.napStartTimeOffset * 60_000 : null;
  return {
    start: localIsoFromOffset(nap.napStartTimestampGMT, offsetMs),
    end: localIsoFromOffset(nap.napEndTimestampGMT, offsetMs),
    duration: formatHoursMinutes(nap.napTimeSec),
    feedback: nap.napFeedback,
  };
}

export function formatSleep(sleep: DailySleep | null, date: string, timeZone: string) {
  if (!hasSleepData(sleep)) {
    return {
      date,
      time_zone: timeZone,
      no_data: true,
      note: 'No sleep recorded for the night ending on this date.',
    };
  }
  const total = sleep.sleepTimeSeconds ?? 0;
  const scores = sleep.sleepScores;
  return {
    date,
    time_zone: timeZone,
    sleep_start: garminGmtToLocalIso(sleep.sleepStartTimestampGMT, timeZone),
    sleep_end: garminGmtToLocalIso(sleep.sleepEndTimestampGMT, timeZone),
    duration: formatHoursMinutes(total),
    duration_s: total,
    score: {
      overall: scores?.overall?.value,
      qualifier: scores?.overall?.qualifierKey,
      feedback: sleep.sleepScoreFeedback,
      insight: sleep.sleepScoreInsight,
      personalized_insight: sleep.sleepScorePersonalizedInsight,
    },
    score_components: {
      total_duration: score(scores?.totalDuration, 'duration'),
      stress: score(scores?.stress),
      awake_count: score(scores?.awakeCount),
      restlessness: score(scores?.restlessness),
      deep_percentage: score(scores?.deepPercentage, 'percent'),
      light_percentage: score(scores?.lightPercentage, 'percent'),
      rem_percentage: score(scores?.remPercentage, 'percent'),
    },
    stages: {
      deep: stage(sleep.deepSleepSeconds, total),
      light: stage(sleep.lightSleepSeconds, total),
      rem: stage(sleep.remSleepSeconds, total),
      awake: { ...stage(sleep.awakeSleepSeconds, total), percent: null },
    },
    awake_count: sleep.awakeCount,
    nap: sleep.napTimeSeconds ? formatHoursMinutes(sleep.napTimeSeconds) : null,
    naps: sleep.dailyNapDTOS?.length ? sleep.dailyNapDTOS.map(formatNap) : null,
    avg_hr_bpm: round(sleep.avgHeartRate),
    avg_respiration_brpm: round(sleep.averageRespirationValue, 1),
    lowest_respiration_brpm: round(sleep.lowestRespirationValue, 1),
    highest_respiration_brpm: round(sleep.highestRespirationValue, 1),
    breathing_disruptions: sleep.breathingDisruptionSeverity,
    avg_spo2_pct: round(sleep.averageSpO2Value),
    lowest_spo2_pct: round(sleep.lowestSpO2Value),
    avg_sleep_stress: round(sleep.avgSleepStress),
    sleep_need: sleepNeed(sleep.sleepNeed),
    next_sleep_need: sleepNeed(sleep.nextSleepNeed),
  };
}
