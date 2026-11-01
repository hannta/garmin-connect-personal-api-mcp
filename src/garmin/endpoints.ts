// One function per Garmin Personal API endpoint used by the tools. Paths and parameters
// were verified against the live API in Phase 0 (discovery/FINDINGS.md). Inputs are
// validated here so every caller gets the same limits.

import { parseIsoDate, validateRange } from '../lib/dates';
import type { GarminClient } from './client';
import type {
  ActivityDetail,
  ActivityStreams,
  ActivitySummary,
  DailySleep,
  DailySummary,
  DailySummariesResponse,
  HeartRateZones,
  HrvDay,
  HrvRangeResponse,
  HrvSummary,
  ProfileSettings,
} from './types';

export const LIMITS = {
  dailySummaryDays: 365,
  hrvRangeDays: 365,
  activitySearchDays: 366,
  activitySearchMaxResults: 100,
  activitySearchDefaultResults: 20,
  streamMaxPoints: 500,
} as const;

function activityIdPath(activityId: number): string {
  if (!Number.isSafeInteger(activityId) || activityId <= 0) {
    throw new RangeError(`Invalid Garmin activity ID: ${activityId}`);
  }
  return String(activityId);
}

export async function getProfileSettings(client: GarminClient): Promise<ProfileSettings> {
  return client.getJson('/userprofile-service/userprofile/settings', {}, 'profile settings');
}

export async function getHeartRateZones(client: GarminClient): Promise<HeartRateZones[]> {
  return client.getJson('/biometric-service/heartRateZones/v2', {}, 'heart-rate zones');
}

export async function getDailySummaries(
  client: GarminClient,
  start: string,
  end: string,
): Promise<DailySummary[]> {
  validateRange(start, end, LIMITS.dailySummaryDays);
  const response = await client.getJson<DailySummariesResponse>(
    '/usersummary-service/v2/dailysummaries',
    { startDate: start, endDate: end },
    `daily summaries ${start} – ${end}`,
  );
  return response.data ?? [];
}

/** Sleep is keyed by the wake-up date: `date` = the morning the night ended. */
export async function getSleep(client: GarminClient, date: string): Promise<DailySleep> {
  parseIsoDate(date);
  return client.getJson('/sleep-service/sleep/dailySleep', { date }, `sleep for ${date}`);
}

export async function getHrv(client: GarminClient, date: string): Promise<HrvDay> {
  parseIsoDate(date);
  return client.getJson(`/hrv-service/hrv/${date}`, {}, `HRV for ${date}`);
}

export async function getHrvRange(
  client: GarminClient,
  start: string,
  end: string,
): Promise<HrvSummary[]> {
  validateRange(start, end, LIMITS.hrvRangeDays);
  const response = await client.getJson<HrvRangeResponse>(
    `/hrv-service/hrv/daily/${start}/${end}`,
    {},
    `HRV ${start} – ${end}`,
  );
  return response.hrvSummaries ?? [];
}

export interface ActivitySearch {
  start: string;
  end: string;
  /** Garmin activity type key, e.g. "running". */
  activityType?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export async function searchActivities(
  client: GarminClient,
  search: ActivitySearch,
): Promise<ActivitySummary[]> {
  validateRange(search.start, search.end, LIMITS.activitySearchDays);
  const limit = Math.min(
    Math.max(Math.trunc(search.limit ?? LIMITS.activitySearchDefaultResults), 1),
    LIMITS.activitySearchMaxResults,
  );
  const offset = Math.max(Math.trunc(search.offset ?? 0), 0);
  return client.getJson(
    '/activitylist-service/activities/search/activities',
    {
      startDate: search.start,
      endDate: search.end,
      activityType: search.activityType,
      start: offset,
      limit,
    },
    `activities ${search.start} – ${search.end}`,
  );
}

export async function getActivity(
  client: GarminClient,
  activityId: number,
): Promise<ActivityDetail> {
  return client.getJson(
    `/activity-service/activity/${activityIdPath(activityId)}`,
    {},
    `activity ${activityId}`,
  );
}

/** Garmin-downsampled streams; Garmin returns roughly `points` rows. */
export async function getActivityStreams(
  client: GarminClient,
  activityId: number,
  points = 100,
): Promise<ActivityStreams> {
  const maxChartSize = Math.min(Math.max(Math.trunc(points), 10), LIMITS.streamMaxPoints);
  return client.getJson(
    `/activity-service/activity/${activityIdPath(activityId)}/details`,
    { maxChartSize },
    `streams for activity ${activityId}`,
  );
}
