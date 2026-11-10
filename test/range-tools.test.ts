import { describe, expect, it } from 'vitest';
import type { ActivitySummary } from '../src/garmin/types';
import { MemoryStore } from '../src/garmin/store';
import { getActivityStreamsTool } from '../src/tools/get-activity-streams';
import { getDaysTool } from '../src/tools/get-days';
import { getWeightTool } from '../src/tools/get-weight';
import { resolveRange, stats, summarize } from '../src/tools/range';
import { searchActivitiesTool } from '../src/tools/search-activities';
import {
  getDailySummariesTool,
  getHrvSummariesTool,
  getSleepSummariesTool,
} from '../src/tools/summaries';
import {
  FailingWriteStore,
  NOW_MS,
  PROFILE_PATH,
  expectNoPrivateFields,
  fixture,
  json,
  toolSetup,
} from './helpers';

const DAILY = '/usersummary-service/v2/dailysummaries';
const SLEEP = '/sleep-service/sleep/dailySleepSummariesByDate';
const HRV = '/hrv-service/hrv/daily/';
const SEARCH = '/activitylist-service/activities/search/activities';
const WEIGHT = '/weight-service/weight/range/';

const activities = () => fixture('activities-search.json') as ActivitySummary[];

function activity(date: string, overrides: Partial<ActivitySummary> = {}): ActivitySummary {
  return {
    ...activities()[0],
    activityId: Number(date.replaceAll('-', '')),
    startTimeLocal: `${date} 08:00:00`,
    startTimeGMT: `${date} 06:00:00`,
    ...overrides,
  };
}

describe('range handling', () => {
  const { context } = toolSetup({});

  it('defaults to the 7 days ending today', async () => {
    expect(await resolveRange({}, context, 31, 'Sleep summaries')).toEqual({
      start: '2026-02-24',
      end: '2026-03-02',
    });
  });

  it('extends one given date to 7 days, never past today', async () => {
    expect(await resolveRange({ end_date: '2026-02-10' }, context, 31, 'X')).toEqual({
      start: '2026-02-04',
      end: '2026-02-10',
    });
    expect(await resolveRange({ start_date: '2026-02-01' }, context, 31, 'X')).toEqual({
      start: '2026-02-01',
      end: '2026-02-07',
    });
    expect(await resolveRange({ start_date: '2026-02-28' }, context, 31, 'X')).toEqual({
      start: '2026-02-28',
      end: '2026-03-02',
    });
  });

  it('rejects ranges over the maximum instead of splitting them', async () => {
    await expect(
      resolveRange({ start_date: '2026-01-01', end_date: '2026-02-28' }, context, 31, 'Sleep'),
    ).rejects.toThrow(/Sleep cover at most 31 days per call.*59 days.*Split the range/);
    await expect(
      resolveRange({ start_date: '2026-03-02', end_date: '2026-03-01' }, context, 31, 'X'),
    ).rejects.toThrow(/after end date/);
  });

  it('summarizes present values only', () => {
    expect(stats([50, null, 52, undefined, 51])).toEqual({ avg: 51, min: 50, max: 52, days: 3 });
    expect(stats([null, null])).toBeNull();
    expect(summarize([{ a: 1 }, { a: 2 }], ['a'])).toEqual({
      a: { avg: 1.5, min: 1, max: 2, days: 2 },
    });
  });
});

describe('garmin_get_daily_summaries', () => {
  it('makes one request for the range and returns flat rows', async () => {
    const { context, paths, query } = toolSetup({
      [DAILY]: () => json(fixture('daily-summaries.json')),
    });
    const result = await getDailySummariesTool.run(
      { start_date: '2026-03-01', end_date: '2026-03-02' },
      context,
    );
    expect(paths().filter((path) => path === DAILY)).toHaveLength(1);
    expect(query(DAILY)).toEqual({ startDate: '2026-03-01', endDate: '2026-03-02' });
    expect(result.days.map((day) => day.date)).toEqual(['2026-03-01', '2026-03-02']);
    expect(result.days[0]?.resting_hr_bpm).toEqual(expect.any(Number));
    expect(result.days[0]).toMatchObject({ calories_total_kcal: 2500, calories_active_kcal: 700 });
    expect(result.summary.resting_hr_bpm?.days).toBe(2);
  });

  it('caps the range at 92 days', async () => {
    const { context, paths } = toolSetup({});
    await expect(
      getDailySummariesTool.run({ start_date: '2025-10-01', end_date: '2026-03-02' }, context),
    ).rejects.toThrow(/at most 92 days/);
    expect(paths()).not.toContain(DAILY);
  });
});

describe('garmin_get_sleep_summaries', () => {
  it('returns nights with data, with local bedtimes', async () => {
    const { context, query } = toolSetup({ [SLEEP]: () => json(fixture('sleep-range.json')) });
    const result = await getSleepSummariesTool.run({}, context);
    expect(query(SLEEP)).toEqual({ startDate: '2026-02-24', endDate: '2026-03-02' });
    expect(result.nights.map((night) => night.date)).toEqual(['2026-03-01', '2026-03-02']);
    const last = result.nights[1];
    expect(last).toMatchObject({ duration_min: 435, bedtime: '23:10', wake_time: '06:50' });
    expect(result.nights[0]?.nap_min).toBe(20);
    expect(last?.nap_min).toBeNull();
    expect(result.summary.duration_min).toMatchObject({ min: 400, max: 435, days: 2 });
  });

  it("enforces Garmin's 31-night limit", async () => {
    const { context } = toolSetup({});
    await expect(
      getSleepSummariesTool.run({ start_date: '2026-01-01', end_date: '2026-02-01' }, context),
    ).rejects.toThrow(/at most 31 days/);
  });
});

describe('garmin_get_hrv_summaries', () => {
  it('reads the HRV range endpoint once', async () => {
    const { context, paths } = toolSetup({ [HRV]: () => json(fixture('hrv-daily.json')) });
    const result = await getHrvSummariesTool.run({}, context);
    expect(paths()).toContain('/hrv-service/hrv/daily/2026-02-24/2026-03-02');
    expect(result.nights[0]).toMatchObject({ date: '2026-03-01' });
    expect(result.nights[0]?.status).toEqual(expect.any(String));
    expect(result.summary.last_night_avg_ms?.days).toBe(2);
  });
});

describe('garmin_get_days', () => {
  const routes = {
    [DAILY]: () => json(fixture('daily-summaries.json')),
    [SLEEP]: () => json(fixture('sleep-range.json')),
    [HRV]: () => json(fixture('hrv-daily.json')),
    [SEARCH]: () => json(activities()),
  };

  it('joins four sources into one row per day', async () => {
    const { context, paths } = toolSetup(routes);
    const result = await getDaysTool.run({}, context);

    expect(paths().filter((path) => path !== PROFILE_PATH)).toHaveLength(4);
    expect(result.days.map((day) => day.date)).toEqual([
      '2026-02-24',
      '2026-02-25',
      '2026-02-26',
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
      '2026-03-02',
    ]);
    const sunday = result.days[5];
    expect(sunday).toMatchObject({ date: '2026-03-01', sleep_min: 400, activity_count: 1 });
    expect(sunday?.resting_hr_bpm).toEqual(expect.any(Number));
    expect(sunday?.hrv_ms).toEqual(expect.any(Number));
    expect(sunday?.activity_distance_km).toBeCloseTo(21.1, 1);
    // Rest days count as zero load, so the average is per day.
    expect(result.days[0]).toMatchObject({ activity_count: 0, training_load: 0 });
    expect(result.summary.training_load?.days).toBe(7);
    expect(result.warnings).toBeNull();
  });

  it('returns partial data with a warning when a source fails', async () => {
    const { context } = toolSetup({ ...routes, [HRV]: () => json({}, 500) });
    const result = await getDaysTool.run({}, context);
    expect(result.days[5]?.hrv_ms).toBeNull();
    expect(result.days[5]?.sleep_min).toBe(400);
    expect(result.warnings?.[0]).toMatch(/^HRV unavailable/);
  });
});

describe('garmin_search_activities', () => {
  it('leaves out distance and pace for stationary activities and adds fastest splits', async () => {
    const { context } = toolSetup({ [SEARCH]: () => json(activities()) });
    const result = await searchActivitiesTool.run({}, context);
    const [run, strength] = result.activities ?? [];
    expect(run?.fastest_splits?.['5km']).toMatch(/^\d+:\d{2}$/);
    expect(strength?.distance_km).toBeNull();
    expect(strength && 'speed_kmh' in strength).toBe(false);
    expect(strength?.fastest_splits).toBeNull();
  });

  it('groups by week from the profile, including empty and partial weeks', async () => {
    const { context, query } = toolSetup({
      [SEARCH]: () =>
        json([
          activity('2026-02-21', { distance: 30_000, activityTrainingLoad: 200 }),
          activity('2026-02-17', { distance: 10_000, activityTrainingLoad: 80 }),
          activity('2026-02-03', { distance: 12_000, activityTrainingLoad: 90 }),
        ]),
    });
    const result = await searchActivitiesTool.run(
      { start_date: '2026-02-01', end_date: '2026-02-22', group_by: 'week' },
      context,
    );
    expect(query(SEARCH)).toMatchObject({ limit: '100', start: '0' });
    expect(result.first_day_of_week).toBe('monday');
    expect(result.weeks?.map((week) => week.week_start)).toEqual([
      '2026-01-26',
      '2026-02-02',
      '2026-02-09',
      '2026-02-16',
    ]);
    expect(result.weeks?.[0]).toMatchObject({ partial: true, activity_count: 0 });
    expect(result.weeks?.[2]).toMatchObject({ activity_count: 0, distance_km: 0 });
    expect(result.weeks?.[3]).toMatchObject({
      partial: null,
      activity_count: 2,
      distance_km: 40,
      training_load: 280,
      longest: { date: '2026-02-21', distance_km: 30 },
    });
    // The partial first week is left out of the summary.
    expect(result.summary?.distance_km).toMatchObject({ min: 0, max: 40, days: 3 });
  });

  it('asks for a shorter range when a week grouping would miss activities', async () => {
    const { context } = toolSetup({
      [SEARCH]: () => json(Array.from({ length: 100 }, () => activity('2026-02-10'))),
    });
    await expect(
      searchActivitiesTool.run({ start_date: '2026-01-01', group_by: 'week' }, context),
    ).rejects.toThrow(/100 or more activities.*Split the range/);
  });

  it('uses a Sunday week start from the profile and caches it', async () => {
    const store = new MemoryStore(() => NOW_MS);
    const profile = {
      ...(fixture('profile-settings.json') as object),
      firstDayOfWeek: { dayName: 'sunday' },
    };
    const first = toolSetup(
      { [PROFILE_PATH]: () => json(profile), [SEARCH]: () => json([]) },
      { store },
    );
    const result = await searchActivitiesTool.run({ group_by: 'week' }, first.context);
    expect(result.weeks?.[0]?.week_start).toBe('2026-02-22');

    const second = toolSetup({ [SEARCH]: () => json([]) }, { store });
    expect(await second.context.firstDayOfWeek()).toBe('sunday');
    expect(second.paths()).not.toContain(PROFILE_PATH);
  });

  it('uses the profile when the cache cannot be written', async () => {
    const store = new FailingWriteStore(() => NOW_MS);
    const { context } = toolSetup({ [SEARCH]: () => json([]) }, { store });

    const result = await searchActivitiesTool.run({ group_by: 'week' }, context);

    expect(result.time_zone).toBe('Europe/Helsinki');
    expect(result.warning).toBeUndefined();
    expect(await context.firstDayOfWeek()).toBe('monday');
  });
});

describe('garmin_get_weight', () => {
  it('converts grams, sorts by date and reports the change', async () => {
    const { context, paths } = toolSetup({ [WEIGHT]: () => json(fixture('weight-range.json')) });
    const result = await getWeightTool.run({}, context);
    expect(paths()).toContain('/weight-service/weight/range/2026-02-24/2026-03-02');
    expect(result.days).toEqual([
      {
        date: '2026-02-26',
        weight_kg: 75.5,
        weight_min_kg: null,
        weight_max_kg: null,
        bmi: 23.3,
        body_fat_pct: 14.6,
        body_water_pct: 60.1,
        muscle_mass_kg: 35.2,
        bone_mass_kg: 3.4,
      },
      expect.objectContaining({ date: '2026-03-02', weight_kg: 74.8, weight_min_kg: 74.8 }),
    ]);
    expect(result.summary.change_kg).toBe(-0.7);
    expect(result.previous_weigh_in).toEqual({ date: '2026-02-20', weight_kg: 75.9 });
  });
});

describe('garmin_get_activity_streams', () => {
  it('returns columns and rows without location, dropping empty channels', async () => {
    const { context, query } = toolSetup({
      '/activity-service/activity/': () => json(fixture('activity-streams.json')),
    });
    const result = await getActivityStreamsTool.run({ activity_id: 10000000004 }, context);
    expect(query('/activity-service/activity/')).toEqual({ maxChartSize: '100' });
    expect(result.columns).toEqual([
      'distance_km',
      'time_s',
      'hr_bpm',
      'pace_min_per_km',
      'grade_adjusted_pace_min_per_km',
      'cadence_spm',
    ]);
    expect(result.rows?.[1]).toEqual([2.5, 750, 141, '5:00', '4:54', 172]);
    expect(result.rows?.[0]?.[3]).toBeNull();
    expectNoPrivateFields(result);
  });

  it('returns only the requested channels', async () => {
    const { context } = toolSetup({
      '/activity-service/activity/': () => json(fixture('activity-streams.json')),
    });
    const result = await getActivityStreamsTool.run(
      { activity_id: 10000000004, channels: ['hr', 'speed'], points: 300 },
      context,
    );
    expect(result.columns).toEqual(['distance_km', 'time_s', 'hr_bpm', 'speed_kmh']);
    expect(result.rows?.[2]).toEqual([5, 1490, 150, 12.2]);
  });
});
