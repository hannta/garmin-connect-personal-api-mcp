import { describe, expect, it } from 'vitest';
import {
  LIMITS,
  getActivity,
  getActivityStreams,
  getDailySummaries,
  getHeartRateZones,
  getHrv,
  getHrvRange,
  getProfileSettings,
  getSleep,
  searchActivities,
} from '../src/garmin/endpoints';
import { DateInputError } from '../src/lib/dates';
import { fixture, json, makeClient, mockFetch } from './helpers';

function setup(body: unknown) {
  const mock = mockFetch([() => json(body)]);
  const { client } = makeClient(mock.fetch);
  const request = () => {
    const call = mock.dataCalls()[0];
    if (!call) throw new Error('no request made');
    return { path: call.url.pathname, query: Object.fromEntries(call.url.searchParams) };
  };
  return { client, request };
}

describe('profile and zones', () => {
  it('reads profile settings including the time zone', async () => {
    const { client, request } = setup(fixture('profile-settings.json'));
    const profile = await getProfileSettings(client);
    expect(request().path).toBe('/userprofile-service/userprofile/settings');
    expect(profile.timeZone).toBe('Europe/Helsinki');
  });

  it('reads heart-rate zones', async () => {
    const { client, request } = setup(fixture('heart-rate-zones.json'));
    const zones = await getHeartRateZones(client);
    expect(request().path).toBe('/biometric-service/heartRateZones/v2');
    expect(zones[0]?.zone4Floor).toBe(162);
  });
});

describe('daily data', () => {
  it('reads daily summaries for a range', async () => {
    const { client, request } = setup(fixture('daily-summaries.json'));
    const days = await getDailySummaries(client, '2026-03-01', '2026-03-02');
    expect(request()).toEqual({
      path: '/usersummary-service/v2/dailysummaries',
      query: { startDate: '2026-03-01', endDate: '2026-03-02' },
    });
    expect(days.map((d) => d.heartRate?.restingValue)).toEqual([48, 50]);
    expect(days[0]?.intensityMinutes?.vigorous).toBe(38);
  });

  it('returns an empty list when Garmin omits data', async () => {
    const { client } = setup({});
    await expect(getDailySummaries(client, '2026-03-01', '2026-03-01')).resolves.toEqual([]);
  });

  it('reads sleep by wake-up date', async () => {
    const { client, request } = setup(fixture('sleep.json'));
    const sleep = await getSleep(client, '2026-03-02');
    expect(request()).toEqual({
      path: '/sleep-service/sleep/dailySleep',
      query: { date: '2026-03-02' },
    });
    expect(sleep.sleepScores?.overall?.value).toBe(81);
  });

  it('reads one night of HRV and a range', async () => {
    const day = setup(fixture('hrv.json'));
    const hrv = await getHrv(day.client, '2026-03-02');
    expect(day.request().path).toBe('/hrv-service/hrv/2026-03-02');
    expect(hrv.hrvSummary?.status).toBe('BALANCED');

    const range = setup(fixture('hrv-daily.json'));
    const summaries = await getHrvRange(range.client, '2026-03-01', '2026-03-02');
    expect(range.request().path).toBe('/hrv-service/hrv/daily/2026-03-01/2026-03-02');
    expect(summaries.map((s) => s.lastNightAvg)).toEqual([51, 58]);
  });

  it('validates dates before calling Garmin', async () => {
    const { client } = setup({});
    await expect(getSleep(client, '2026-02-30')).rejects.toBeInstanceOf(DateInputError);
    await expect(getDailySummaries(client, '2026-03-02', '2026-03-01')).rejects.toThrow(/after/);
  });
});

describe('activities', () => {
  it('searches with defaults and clamps the limit', async () => {
    const first = setup(fixture('activities-search.json'));
    const activities = await searchActivities(first.client, {
      start: '2026-02-01',
      end: '2026-03-01',
    });
    expect(first.request()).toEqual({
      path: '/activitylist-service/activities/search/activities',
      query: { startDate: '2026-02-01', endDate: '2026-03-01', start: '0', limit: '20' },
    });
    expect(activities[0]?.fastestSplit_21098).toBe(6330);

    const second = setup([]);
    await searchActivities(second.client, {
      start: '2026-02-01',
      end: '2026-03-01',
      activityType: 'running',
      limit: 1000,
      offset: 40,
    });
    expect(second.request().query).toMatchObject({
      activityType: 'running',
      limit: String(LIMITS.activitySearchMaxResults),
      start: '40',
    });
  });

  it('rejects search ranges over a year', async () => {
    const { client } = setup([]);
    await expect(
      searchActivities(client, { start: '2025-01-01', end: '2026-03-01' }),
    ).rejects.toThrow(/maximum/);
  });

  it('reads activity details with split summaries', async () => {
    const { client, request } = setup(fixture('activity.json'));
    const activity = await getActivity(client, 10000000003);
    expect(request().path).toBe('/activity-service/activity/10000000003');
    const active = activity.splitSummaries?.find((s) => s.splitType === 'INTERVAL_ACTIVE');
    expect(active?.noOfSplits).toBe(10);
  });

  it('rejects invalid activity IDs', async () => {
    const { client } = setup({});
    await expect(getActivity(client, -1)).rejects.toThrow(RangeError);
    await expect(getActivity(client, 1.5)).rejects.toThrow(RangeError);
  });

  it('reads Garmin-downsampled streams with a capped point count', async () => {
    const { client, request } = setup(fixture('activity-details.json'));
    const streams = await getActivityStreams(client, 10000000003, 10_000);
    expect(request()).toEqual({
      path: '/activity-service/activity/10000000003/details',
      query: { maxChartSize: String(LIMITS.streamMaxPoints) },
    });
    expect(streams.metricDescriptors?.map((d) => d.key)).toContain('directHeartRate');
  });
});
