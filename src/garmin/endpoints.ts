// One function per Garmin Personal API endpoint used by the tools. Paths and parameters
// were verified against the live API (docs/garmin-api-notes.md). Inputs are
// validated here so every caller gets the same limits.

import { parseIsoDate, validateRange } from '../lib/dates';
import type { GarminClient } from './client';
import type {
  ActivityDetail,
  ActivityStreams,
  ActivitySummary,
  ActivityWorkout,
  BodyBatteryDay,
  DailyHeartRate,
  DailyHydration,
  DailyNutritionSummary,
  DailySleep,
  DailySteps,
  DailyStress,
  DailySummary,
  DailySummariesResponse,
  FitnessAge,
  HeartRateZones,
  HrvDay,
  HrvRangeResponse,
  HrvSummary,
  MenstrualCycleSummary,
  MenstrualDayView,
  ProfileSettings,
  Spo2Day,
  WeightGoalsResponse,
  WeightRangeResponse,
  WellnessActivitySummary,
} from './types';

// Garmin's own per-request maximums (tested 2026-11-02); tools may allow less.
export const LIMITS = {
  dailySummaryDays: 180,
  hrvRangeDays: 365,
  sleepRangeDays: 31,
  weightRangeDays: 366,
  activitySearchDays: 366,
  activitySearchMaxResults: 100,
  activitySearchDefaultResults: 20,
  streamMaxPoints: 500,
  stepsRangeDays: 28,
  stressRangeDays: 28,
  bodyBatteryRangeDays: 31,
  hydrationRangeDays: 31,
  wellnessActivityRangeDays: 366,
  weightGoalRangeDays: 366,
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

/**
 * One night, keyed by the wake-up date (the morning the night ended); null without data.
 * Reads the range endpoint for that one date: it returns the same fields as
 * `/sleep/dailySleep` plus the day's naps and breathing disruptions (checked 2026-11-03).
 */
export async function getSleep(client: GarminClient, date: string): Promise<DailySleep | null> {
  parseIsoDate(date);
  const response = await client.getJson<DailySleep[] | null>(
    '/sleep-service/sleep/dailySleepSummariesByDate',
    { startDate: date, endDate: date },
    `sleep for ${date}`,
  );
  const nights = Array.isArray(response) ? response : [];
  return nights.find((night) => night.calendarDate === date) ?? nights[0] ?? null;
}

/** One entry per night (wake-up date), oldest first; same fields as `getSleep`. */
export async function getSleepRange(
  client: GarminClient,
  start: string,
  end: string,
): Promise<DailySleep[]> {
  validateRange(start, end, LIMITS.sleepRangeDays);
  const response = await client.getJson<DailySleep[] | null>(
    '/sleep-service/sleep/dailySleepSummariesByDate',
    { startDate: start, endDate: end },
    `sleep ${start} – ${end}`,
  );
  return Array.isArray(response) ? response : [];
}

export async function getWeightRange(
  client: GarminClient,
  start: string,
  end: string,
): Promise<WeightRangeResponse> {
  validateRange(start, end, LIMITS.weightRangeDays);
  return client.getJson(
    `/weight-service/weight/range/${start}/${end}`,
    {},
    `weight ${start} – ${end}`,
  );
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

/** Charged / drained, samples and the events (sleep, activities, …) per day. */
export async function getBodyBatteryRange(
  client: GarminClient,
  start: string,
  end: string,
): Promise<BodyBatteryDay[]> {
  validateRange(start, end, LIMITS.bodyBatteryRangeDays);
  const response = await client.getJson<BodyBatteryDay[] | null>(
    '/wellness-service/wellness/bodyBattery/reports/daily',
    { startDate: start, endDate: end },
    `Body Battery ${start} – ${end}`,
  );
  return Array.isArray(response) ? response : [];
}

export async function getStressRange(
  client: GarminClient,
  start: string,
  end: string,
): Promise<DailyStress[]> {
  validateRange(start, end, LIMITS.stressRangeDays);
  const response = await client.getJson<DailyStress[] | null>(
    `/usersummary-service/stats/stress/daily/${start}/${end}`,
    {},
    `stress ${start} – ${end}`,
  );
  return Array.isArray(response) ? response : [];
}

export async function getStepsRange(
  client: GarminClient,
  start: string,
  end: string,
): Promise<DailySteps[]> {
  validateRange(start, end, LIMITS.stepsRangeDays);
  const response = await client.getJson<DailySteps[] | null>(
    `/usersummary-service/stats/steps/daily/${start}/${end}`,
    {},
    `steps ${start} – ${end}`,
  );
  return Array.isArray(response) ? response : [];
}

/** All-day heart rate: resting / min / max and samples every 2 minutes. */
export async function getDailyHeartRate(
  client: GarminClient,
  date: string,
): Promise<DailyHeartRate> {
  parseIsoDate(date);
  return client.getJson(
    '/wellness-service/wellness/dailyHeartRate',
    { date },
    `heart rate for ${date}`,
  );
}

export async function getSpo2(client: GarminClient, date: string): Promise<Spo2Day> {
  parseIsoDate(date);
  return client.getJson(
    `/wellness-service/wellness/daily/spo2acclimation/${date}`,
    {},
    `SpO2 for ${date}`,
  );
}

export async function getFitnessAge(client: GarminClient, date: string): Promise<FitnessAge> {
  parseIsoDate(date);
  return client.getJson(`/fitnessage-service/fitnessage/v2/${date}`, {}, `fitness age for ${date}`);
}

export async function getWeightGoals(
  client: GarminClient,
  start: string,
  end: string,
): Promise<WeightGoalsResponse | null> {
  validateRange(start, end, LIMITS.weightGoalRangeDays);
  return client.getOptionalJson(
    `/goal-service/goal/user/effective/weightgoal/${start}/${end}`,
    {},
    `weight goals ${start} – ${end}`,
  );
}

// The endpoints below returned no data for the owner's account (2026-11-03); their
// types follow Garmin's OpenAPI spec. Empty responses (204) are null.

export async function getHydrationRange(
  client: GarminClient,
  start: string,
  end: string,
): Promise<DailyHydration[] | null> {
  validateRange(start, end, LIMITS.hydrationRangeDays);
  return client.getOptionalJson(
    `/usersummary-service/stats/hydration/daily/${start}/${end}`,
    {},
    `hydration ${start} – ${end}`,
  );
}

export async function getWellnessActivities(
  client: GarminClient,
  start: string,
  end: string,
): Promise<WellnessActivitySummary[] | null> {
  validateRange(start, end, LIMITS.wellnessActivityRangeDays);
  return client.getOptionalJson(
    `/wellnessactivity-service/activity/summary/range/${start}/${end}`,
    {},
    `wellness activities ${start} – ${end}`,
  );
}

export async function getFoodLog(
  client: GarminClient,
  date: string,
): Promise<DailyNutritionSummary | null> {
  parseIsoDate(date);
  return client.getOptionalJson(`/nutrition-service/food/logs/${date}`, {}, `food log for ${date}`);
}

export async function getMenstrualSummary(
  client: GarminClient,
  date: string,
): Promise<MenstrualCycleSummary | null> {
  parseIsoDate(date);
  return client.getOptionalJson(
    `/periodichealth-service/menstrualcycle/summary/${date}`,
    {},
    `menstrual cycle for ${date}`,
  );
}

export async function getMenstrualDay(
  client: GarminClient,
  date: string,
  today: string,
): Promise<MenstrualDayView | null> {
  parseIsoDate(date);
  parseIsoDate(today);
  return client.getOptionalJson(
    `/periodichealth-service/menstrualcycle/dayview/${date}`,
    { todayDate: today },
    `menstrual cycle day ${date}`,
  );
}

/** The structured workout an activity was started from; `[]` if none. */
export async function getActivityWorkouts(
  client: GarminClient,
  activityId: number,
): Promise<ActivityWorkout[] | null> {
  return client.getOptionalJson(
    `/activity-service/activity/${activityIdPath(activityId)}/workouts`,
    {},
    `workouts for activity ${activityId}`,
  );
}
