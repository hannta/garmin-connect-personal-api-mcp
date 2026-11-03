import { describe, expect, it } from 'vitest';
import type { ActivitySummary } from '../src/garmin/types';
import { MemoryStore } from '../src/garmin/store';
import { getActivityTool, strengthSummary } from '../src/tools/get-activity';
import { getDayTool } from '../src/tools/get-day';
import { getHrvTool } from '../src/tools/get-hrv';
import { getProfileTool } from '../src/tools/get-profile';
import { getSleepTool } from '../src/tools/get-sleep';
import { searchActivitiesTool } from '../src/tools/search-activities';
import { NOW_MS, PROFILE_PATH, expectNoPrivateFields, fixture, json, toolSetup } from './helpers';

const PROFILE = PROFILE_PATH;
const SEARCH = '/activitylist-service/activities/search/activities';
const setup = toolSetup;
type Routes = Parameters<typeof toolSetup>[0];

describe('time zone', () => {
  it('uses the Garmin profile and caches it in KV', async () => {
    const store = new MemoryStore(() => NOW_MS);
    const first = setup({}, { store });
    expect(await first.context.timeZone()).toEqual({
      timeZone: 'Europe/Helsinki',
      source: 'profile',
    });
    expect(await first.context.today()).toBe('2026-03-02');

    const second = setup({}, { store });
    await second.context.timeZone();
    expect(second.paths()).not.toContain(PROFILE);
  });

  it('prefers a valid TIMEZONE override without calling Garmin', async () => {
    const { context, paths } = setup({}, { timeZone: 'America/New_York' });
    expect(await context.timeZone()).toMatchObject({ timeZone: 'America/New_York' });
    expect(await context.today()).toBe('2026-03-02');
    expect(paths()).toEqual([]);
  });

  it('ignores an invalid override with a warning', async () => {
    const { context } = setup({}, { timeZone: 'Mars/Olympus' });
    const zone = await context.timeZone();
    expect(zone.timeZone).toBe('Europe/Helsinki');
    expect(zone.warning).toMatch(/Mars\/Olympus/);
  });

  it('falls back to UTC with a warning when the profile fails', async () => {
    const { context } = setup({ [PROFILE]: () => json({}, 500) });
    expect(await context.timeZone()).toMatchObject({ timeZone: 'UTC', source: 'utc' });
  });
});

describe('garmin_search_activities', () => {
  it('defaults to the last 7 days and returns compact rows', async () => {
    const { context, query } = setup({ [SEARCH]: () => json(fixture('activities-search.json')) });
    const result = await searchActivitiesTool.run({}, context);
    if (!result.activities) throw new Error('expected an activity list');

    expect(query(SEARCH)).toMatchObject({
      startDate: '2026-02-24',
      endDate: '2026-03-02',
      limit: '20',
      start: '0',
    });
    expect(result).toMatchObject({ start_date: '2026-02-24', end_date: '2026-03-02', count: 2 });
    expect(result.activities[0]).toMatchObject({
      id: 10000000002,
      type: 'running',
      start_local: '2026-03-01T09:30:00+02:00',
    });
    const row: Record<string, unknown> | undefined = result.activities[0];
    expect(row?.pace_min_per_km).toMatch(/^\d+:\d{2}$/);
    expect(result.next_offset).toBeNull();
    expectNoPrivateFields(result);
  });

  it('passes filters and offers the next page when the page is full', async () => {
    const { context, query } = setup({ [SEARCH]: () => json(fixture('activities-search.json')) });
    const result = await searchActivitiesTool.run(
      {
        start_date: '2026-02-01',
        end_date: '2026-02-28',
        activity_type: 'running',
        limit: 2,
        offset: 4,
      },
      context,
    );
    expect(query(SEARCH)).toMatchObject({ activityType: 'running', limit: '2', start: '4' });
    expect(result.next_offset).toBe(6);
  });
});

describe('garmin_get_activity', () => {
  const searchItem = (): ActivitySummary => ({
    ...(fixture('activities-search.json') as ActivitySummary[])[0],
    activityId: 10000000003,
    powerTimeInZone_1: 600,
    powerTimeInZone_2: 600,
    vO2MaxValue: 55.2,
  });

  it('combines activity details with zone times from search', async () => {
    const { context, query } = setup({
      '/activity-service/activity/': () => json(fixture('activity.json')),
      [SEARCH]: () => json([searchItem()]),
    });
    const result = await getActivityTool.run({ activity_id: 10000000003 }, context);

    expect(query(SEARCH)).toMatchObject({ startDate: '2026-03-03', endDate: '2026-03-03' });
    expect(result.id).toBe(10000000003);
    expect(result.start_local).toMatch(/^2026-03-03T17:00:00[+-]\d{2}:\d{2}$/);
    expect(result.time_in_hr_zones).toHaveLength(5);
    expect(result.time_in_power_zones?.[0]).toMatchObject({ zone: 1, percent: 50 });
    expect(result.intervals?.map((row) => row.type)).toEqual(
      expect.arrayContaining(['active', 'recovery']),
    );
    const types = result.intervals?.map((row) => row.type) ?? [];
    expect(types.indexOf('active')).toBeLessThan(types.indexOf('recovery'));
    expect(result.perceived.rpe).toBeGreaterThanOrEqual(1);
    expect(result.perceived.rpe).toBeLessThanOrEqual(10);
    expect(result).toMatchObject({
      elevation: { min_m: 95, max_m: 132 },
      running_dynamics: { max_cadence_spm: 196 },
      training_effect: {
        aerobic_message: 'IMPROVING_VO2_MAX_15',
        anaerobic_message: 'MAINTAINING_ANAEROBIC_FITNESS_10',
      },
      sweat_loss_ml: 640,
      temperature_c: { min: 4, max: 9 },
      respiration_brpm: { min: 18, max: 43 },
      vo2max: 55.2,
      lactate_threshold_hr_bpm: null,
      personal_record: true,
      strength: null,
    });
    expect(result.intervals?.find((row) => row.type === 'active')).toMatchObject({
      avg_step_length_m: 1.32,
    });
    expect(result.warnings).toBeNull();
    expectNoPrivateFields(result);
  });

  it('still returns the activity when the zone lookup fails', async () => {
    const { context } = setup({
      '/activity-service/activity/': () => json(fixture('activity.json')),
      [SEARCH]: () => json({}, 500),
    });
    const result = await getActivityTool.run({ activity_id: 10000000003 }, context);
    expect(result.time_in_hr_zones).toBeNull();
    expect(result.warnings?.[0]).toMatch(/zones/);
  });

  it('summarizes strength sets per exercise category in kg', () => {
    const strength = (fixture('activities-search.json') as ActivitySummary[])[1];
    expect(strength && strengthSummary(strength)).toEqual({
      total_sets: 6,
      active_sets: 6,
      total_reps: 45,
      exercises: [
        {
          category: 'SQUAT',
          sub_category: 'GOBLET_SQUAT',
          sets: 3,
          reps: 30,
          max_weight_kg: 16,
          volume_kg: 480,
          duration: '5:00',
        },
        {
          category: 'PLANK',
          sub_category: undefined,
          sets: 3,
          reps: 15,
          max_weight_kg: null,
          volume_kg: null,
          duration: '3:00',
        },
      ],
    });
  });
});

describe('garmin_get_sleep', () => {
  it('formats the night ending on the requested date', async () => {
    const { context, query } = setup({
      '/sleep-service/': () => json([fixture('sleep.json')]),
    });
    const result = await getSleepTool.run({ date: '2026-03-02' }, context);

    expect(query('/sleep-service/')).toEqual({ startDate: '2026-03-02', endDate: '2026-03-02' });
    expect(result).toMatchObject({
      date: '2026-03-02',
      duration: '7h 15m',
      score: { overall: 81 },
    });
    expect(result.sleep_start).toMatch(/\+02:00$/);
    expect(result).toMatchObject({
      score: { personalized_insight: 'POS_GOOD_SLEEP_AFTER_HARD_DAY' },
      score_components: {
        total_duration: { optimal_duration: '8h 0m' },
        stress: { optimal: [0, 15] },
        rem_percentage: { value: 24, optimal_pct: [21, 31] },
      },
      sleep_need: {
        adjusted: '8h 20m',
        adjusted_for: { training: 'CHRONIC', sleep_history: null, hrv: 'INCREASING', naps: null },
      },
      next_sleep_need: {
        adjusted: '7h 50m',
        adjusted_for: { sleep_history: 'DECREASING_HIGH_QUALITY' },
        recommended_bedtime: ['22:30', '23:30'],
      },
      nap: '30m',
      naps: [
        {
          start: '2026-03-02T14:00:00+02:00',
          end: '2026-03-02T14:30:00+02:00',
          duration: '30m',
          feedback: 'IDEAL_TIMING_IDEAL_DURATION',
        },
      ],
      breathing_disruptions: 'LOW',
    });
    expect(result.lowest_respiration_brpm).toEqual(expect.any(Number));
    expect(JSON.stringify(result)).not.toContain('deviceId');
  });

  it('defaults to today and reports a night without data', async () => {
    const { context, query } = setup({ '/sleep-service/': () => json([]) });
    const result = await getSleepTool.run({}, context);
    expect(query('/sleep-service/')).toEqual({ startDate: '2026-03-02', endDate: '2026-03-02' });
    expect(result).toMatchObject({ date: '2026-03-02', no_data: true });
  });
});

describe('garmin_get_hrv', () => {
  it('returns the summary and half-hour averages in local time', async () => {
    const { context, paths } = setup({ '/hrv-service/': () => json(fixture('hrv.json')) });
    const result = await getHrvTool.run({ date: '2026-03-02' }, context);

    expect(paths()).toContain('/hrv-service/hrv/2026-03-02');
    expect(result).toMatchObject({ status: 'BALANCED' });
    const first = 'overnight' in result ? result.overnight?.[0] : undefined;
    expect(first?.time).toBe('23:00');
    expect(typeof first?.hrv_ms).toBe('number');
  });
});

describe('garmin_get_profile', () => {
  it('returns the time zone and HR zones with upper bounds', async () => {
    const { context } = setup({
      '/biometric-service/': () => json(fixture('heart-rate-zones.json')),
    });
    const result = await getProfileTool.run({}, context);

    expect(result).toMatchObject({
      time_zone: 'Europe/Helsinki',
      time_zone_source: 'profile',
      first_day_of_week: 'monday',
      training_days: ['monday', 'wednesday', 'saturday'],
      long_training_days: ['saturday'],
    });
    expect(result.heart_rate_zones[0]?.resting_hr_auto_update).toBe(false);
    const zones = result.heart_rate_zones[0]?.zones;
    expect(zones).toHaveLength(5);
    expect(zones?.[3]).toMatchObject({ zone: 4, from_bpm: 162 });
    expect(zones?.[2]?.to_bpm).toBe(161);
    expectNoPrivateFields(result);
  });
});

describe('garmin_get_day', () => {
  const allRoutes: Routes = {
    '/usersummary-service/': () => json(fixture('daily-summaries.json')),
    '/sleep-service/': () => json([fixture('sleep.json')]),
    '/hrv-service/': () => json(fixture('hrv.json')),
    [SEARCH]: () => json(fixture('activities-search.json')),
  };

  it('combines daily summary, sleep, HRV and activities', async () => {
    const { context } = setup(allRoutes);
    const result = await getDayTool.run({ date: '2026-03-02' }, context);

    expect(result).toMatchObject({
      date: '2026-03-02',
      resting_hr_bpm: 48,
      sleep: { score: 81, duration: '7h 15m' },
      hrv: { status: 'BALANCED' },
    });
    expect(result.intensity_minutes.total).toBe(
      (result.intensity_minutes.moderate ?? 0) + 2 * (result.intensity_minutes.vigorous ?? 0),
    );
    expect(result.activities).toHaveLength(2);
    expect(result.stress).toMatchObject({ rest_min: 720, low_min: 420, high_min: 10 });
    expect(result).toMatchObject({
      heart_rate: { alerts: 1 },
      body_battery: { before_sleep: 31 },
      calories_kcal: { total: 2500, active: 700, eaten: 2100, eaten_goal: 2400 },
      hydration_ml: { intake: 1500, goal: 3000 },
    });
    expect(result.body_battery.events).toEqual([
      expect.objectContaining({ type: 'sleep', start: '2026-02-28T23:00:00+02:00', impact: 50 }),
      expect.objectContaining({
        type: 'activity',
        duration: '1h 0m',
        feedback: 'IMPROVING_AEROBIC_BASE',
      }),
    ]);
    expect(result.body_battery.feedback).toEqual({
      level: 'MODERATE',
      feedback: 'DAY_RECOVERING_AND_EXERCISE',
    });
    expect(result.warnings).toBeNull();
    expectNoPrivateFields(result);
  });

  it('returns partial data with a warning when one source fails', async () => {
    const { context } = setup({ ...allRoutes, '/hrv-service/': () => json({}, 503) });
    const result = await getDayTool.run({ date: '2026-03-02' }, context);
    expect(result.hrv).toBeNull();
    expect(result.resting_hr_bpm).toBe(48);
    expect(result.warnings).toEqual([expect.stringMatching(/^HRV unavailable/)]);
  });

  it('fails when every source fails', async () => {
    const { context } = setup({
      '/usersummary-service/': () => json({}, 500),
      '/sleep-service/': () => json({}, 500),
      '/hrv-service/': () => json({}, 500),
      [SEARCH]: () => json({}, 500),
    });
    await expect(getDayTool.run({ date: '2026-03-02' }, context)).rejects.toMatchObject({
      code: 'upstream',
    });
  });
});
