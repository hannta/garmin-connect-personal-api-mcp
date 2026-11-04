// One row per lap and per interval rep, read from the activity's FIT file. This is the
// heaviest work this server does: on the Workers free plan a long activity can exceed the
// CPU limit, which can't be caught as a tool error. The formatted result is cached, so
// each file is read once and the file itself is never stored.

import { z } from 'zod';
import { getActivityFile } from '../garmin/endpoints';
import { readActivityFile, type FitActivity, type FitMessage } from '../garmin/fit';
import { metersToKm, round } from '../lib/units';
import { defineTool } from './define';
import { durationFields, paceOrSpeed } from './format';

const CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;

// The names `paceOrSpeed` needs; FIT's `sport` enum has many more.
const SPORTS: Record<number, string> = {
  1: 'running',
  2: 'cycling',
  5: 'swimming',
  11: 'walking',
  16: 'mountaineering',
  17: 'hiking',
};

const INTENSITIES: Record<number, string> = {
  0: 'active',
  1: 'rest',
  2: 'warmup',
  3: 'cooldown',
  4: 'recovery',
  5: 'interval',
};

const LAP_TRIGGERS: Record<number, string> = {
  0: 'manual',
  1: 'time',
  2: 'distance',
  3: 'position',
  4: 'position',
  5: 'position',
  6: 'position',
  7: 'session_end',
};

// Run / walk splits are left out: garmin_get_activity has their totals.
const INTERVAL_TYPES: Record<number, string> = {
  3: 'active',
  4: 'rest',
  5: 'warmup',
  6: 'cooldown',
  7: 'recovery',
  8: 'other',
};

const FOOT_SPORTS = new Set(['running', 'walking', 'hiking', 'mountaineering']);

export const getActivityLapsTool = defineTool({
  name: 'garmin_get_activity_laps',
  title: 'Get Garmin activity laps',
  description: [
    'One row per lap of an activity, plus one row per interval rep when it was an interval',
    'session: distance, time, pace and grade-adjusted pace, heart rate, power, cadence,',
    'running dynamics, elevation, calories, temperature and respiration. For questions',
    'like "how did each rep go?" or "which kilometres were slowest?". Location is never',
    'returned. Get the activity id from garmin_search_activities. On the Cloudflare free',
    'plan a long activity can fail with a connector error (CPU limit): say so rather than',
    'retrying.',
  ].join(' '),
  inputSchema: z.object({
    activity_id: z.number().int().positive().describe('Garmin activity ID.'),
  }),
  async run(input, context) {
    const key = `garmin:laps:v1:${input.activity_id}`;
    const cached = await context.store.get(key);
    if (cached) {
      try {
        return JSON.parse(cached) as ReturnType<typeof formatLaps>;
      } catch {
        // Corrupt cache entry: read the file again.
      }
    }
    const what = `activity ${input.activity_id}`;
    const file = await getActivityFile(context.client, input.activity_id);
    const result = formatLaps(input.activity_id, await readActivityFile(file, what));
    // The result is complete without the cache, so a failed write (KV's daily limit) is fine.
    await context.store
      .put(key, JSON.stringify(result), { expirationTtl: CACHE_TTL_SECONDS })
      .catch(() => undefined);
    return result;
  },
});

export function formatLaps(activityId: number, activity: FitActivity) {
  const sport = SPORTS[activity.sessions[0]?.sport ?? -1];
  const start = activity.laps[0]?.startTime ?? activity.splits[0]?.startTime;
  const row = (message: FitMessage) => formatRow(message, sport, start);

  const laps = activity.laps.map((lap, index) => ({
    lap: index + 1,
    intensity: INTENSITIES[lap.intensity ?? -1],
    trigger: LAP_TRIGGERS[lap.trigger ?? -1],
    ...row(lap),
  }));
  const intervals = activity.splits
    .filter((split) => INTERVAL_TYPES[split.type ?? -1])
    .sort((a, b) => (a.startTime ?? 0) - (b.startTime ?? 0))
    .map((split) => ({ type: INTERVAL_TYPES[split.type ?? -1], ...row(split) }));

  return {
    activity_id: activityId,
    sport,
    lap_count: laps.length,
    laps,
    // A single interval is the whole activity, which adds nothing to the laps.
    intervals: intervals.length > 1 ? intervals : null,
    note: laps.length === 0 ? 'Garmin recorded no laps for this activity.' : null,
  };
}

function formatRow(m: FitMessage, sport: string | undefined, start: number | undefined) {
  const onFoot = sport !== undefined && FOOT_SPORTS.has(sport);
  // FIT cadence on foot is per leg; `avgFractionalCadence` is its fraction on laps.
  const cadence = (m.avgCadence ?? 0) + (m.avgFractionalCadence ?? 0);
  return {
    start_elapsed_s:
      m.startTime !== undefined && start !== undefined ? m.startTime - start : undefined,
    distance_km: metersToKm(m.distance),
    ...durationFields(m.timerTime),
    ...durationFields(m.movingTime, 'moving_duration'),
    ...durationFields(m.elapsedTime, 'elapsed_duration'),
    ...paceOrSpeed(sport, m.enhancedAvgSpeed ?? m.avgSpeed, 'avg_'),
    ...paceOrSpeed(sport, m.avgGradeAdjustedSpeed, 'avg_grade_adjusted_'),
    ...paceOrSpeed(sport, m.enhancedMaxSpeed ?? m.maxSpeed, 'max_'),
    avg_hr_bpm: round(m.avgHeartRate),
    max_hr_bpm: round(m.maxHeartRate),
    avg_power_w: round(m.avgPower),
    max_power_w: round(m.maxPower),
    ...(onFoot && m.avgCadence !== undefined ? { avg_cadence_spm: round(cadence * 2) } : {}),
    ...(onFoot && m.maxCadence !== undefined ? { max_cadence_spm: round(m.maxCadence * 2) } : {}),
    ...(sport === 'cycling' ? { avg_cadence_rpm: round(m.avgCadence) } : {}),
    ground_contact_time_ms: round(m.stanceTime),
    stride_length_cm: round(mmToCm(m.stepLength)),
    vertical_oscillation_cm: round(mmToCm(m.verticalOscillation), 1),
    vertical_ratio_pct: round(m.verticalRatio, 1),
    ascent_m: round(m.ascent),
    descent_m: round(m.descent),
    calories_kcal: round(m.calories),
    avg_temperature_c: round(m.avgTemperature),
    avg_respiration_brpm: round(m.avgRespiration),
  };
}

function mmToCm(value: number | undefined): number | undefined {
  return value === undefined ? undefined : value / 10;
}
