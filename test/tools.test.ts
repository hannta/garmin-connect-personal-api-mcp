import { describe, expect, it } from 'vitest';
import type { ActivitySummary } from '../src/garmin/types';
import { MemoryStore } from '../src/garmin/store';
import { createToolContext } from '../src/tools/context';
import { getActivityTool } from '../src/tools/get-activity';
import { getDayTool } from '../src/tools/get-day';
import { getHrvTool } from '../src/tools/get-hrv';
import { getProfileTool } from '../src/tools/get-profile';
import { getSleepTool } from '../src/tools/get-sleep';
import { searchActivitiesTool } from '../src/tools/search-activities';
import { NOW_MS, fixture, json, makeClient, routedFetch } from './helpers';

type Routes = Parameters<typeof routedFetch>[0];

const PROFILE = '/userprofile-service/userprofile/settings';
const SEARCH = '/activitylist-service/activities/search/activities';

function setup(routes: Routes, options: { timeZone?: string; store?: MemoryStore } = {}) {
  const store = options.store ?? new MemoryStore(() => NOW_MS);
  const mock = routedFetch({ [PROFILE]: () => json(fixture('profile-settings.json')), ...routes });
  const { client } = makeClient(mock.fetch, store);
  const context = createToolContext({
    client: () => client,
    store,
    timeZoneOverride: options.timeZone,
    now: () => new Date(NOW_MS), // 2026-03-02 10:00 in Helsinki
  });
  const paths = () => mock.dataCalls().map((call) => call.url.pathname);
  const query = (prefix: string) =>
    Object.fromEntries(
      mock.dataCalls().find((call) => call.url.pathname.startsWith(prefix))?.url.searchParams ?? [],
    );
  return { context, paths, query, store };
}

/** Garmin's location and owner fields must never appear in tool output. */
function expectNoPrivateFields(output: unknown) {
  const text = JSON.stringify(output);
  for (const key of ['Latitude', 'Longitude', 'locationName', 'owner', 'displayName']) {
    expect(text).not.toContain(key);
  }
}

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
});

describe('garmin_get_sleep', () => {
  it('formats the night ending on the requested date', async () => {
    const { context, query } = setup({
      '/sleep-service/': () => json(fixture('sleep.json')),
    });
    const result = await getSleepTool.run({ date: '2026-03-02' }, context);

    expect(query('/sleep-service/')).toEqual({ date: '2026-03-02' });
    expect(result).toMatchObject({
      date: '2026-03-02',
      duration: '7h 15m',
      score: { overall: 81 },
    });
    expect(result.sleep_start).toMatch(/\+02:00$/);
  });

  it('defaults to today and reports a night without data', async () => {
    const { context, query } = setup({ '/sleep-service/': () => json({}, 404) });
    const result = await getSleepTool.run({}, context);
    expect(query('/sleep-service/')).toEqual({ date: '2026-03-02' });
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
    });
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
    '/sleep-service/': () => json(fixture('sleep.json')),
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
