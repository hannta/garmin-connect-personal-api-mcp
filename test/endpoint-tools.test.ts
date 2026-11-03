import { describe, expect, it } from 'vitest';
import { getFitnessAgeTool, getHeartRateZonesTool, getWeightGoalsTool } from '../src/tools/fitness';
import { getHeartRateTool } from '../src/tools/get-heart-rate';
import { getSpo2Tool } from '../src/tools/get-spo2';
import { getMenstrualCycleTool, getMenstrualDayTool } from '../src/tools/menstrual';
import { getFoodLogTool, getHydrationTool } from '../src/tools/nutrition';
import { getBodyBatteryTool, getStepsTool, getStressTool } from '../src/tools/wellness';
import { getWellnessActivitiesTool } from '../src/tools/wellness-activities';
import { getActivityWorkoutsTool } from '../src/tools/workouts';
import { expectNoPrivateFields, fixture, json, toolSetup } from './helpers';

const BODY_BATTERY = '/wellness-service/wellness/bodyBattery/reports/daily';
const STRESS = '/usersummary-service/stats/stress/daily/';
const STEPS = '/usersummary-service/stats/steps/daily/';
const HEART_RATE = '/wellness-service/wellness/dailyHeartRate';
const SPO2 = '/wellness-service/wellness/daily/spo2acclimation/';
const FITNESS_AGE = '/fitnessage-service/fitnessage/v2/';
const WEIGHT_GOALS = '/goal-service/goal/user/effective/weightgoal/';
const HR_ZONES = '/biometric-service/heartRateZones/v2';
const empty = () => new Response(null, { status: 204 });

describe('garmin_get_body_battery', () => {
  it('returns charge, drain and events per day, sorted, in one request', async () => {
    const { context, paths, query } = toolSetup({
      [BODY_BATTERY]: () => json(fixture('body-battery.json')),
    });
    const result = await getBodyBatteryTool.run({}, context);

    expect(paths().filter((path) => path === BODY_BATTERY)).toHaveLength(1);
    expect(query(BODY_BATTERY)).toEqual({ startDate: '2026-02-24', endDate: '2026-03-02' });
    expect(result.days.map((day) => day.date)).toEqual(['2026-03-01', '2026-03-02']);
    expect(result.days[0]).toMatchObject({
      charged: 55,
      drained: 52,
      events: [
        {
          type: 'activity',
          start: '2026-03-01T09:00:00+02:00',
          duration: '1h 0m',
          duration_min: 60,
          impact: -12,
          feedback: 'IMPROVING_AEROBIC_BASE',
        },
      ],
      end_of_day_feedback: { level: 'LOW', feedback: 'SLEEP_TIME_PASSED_RECOVERING' },
      samples: null,
    });
    expect(result.days[1]?.events[0]).toMatchObject({ type: 'sleep', feedback: null });
    expect(result.summary.charged).toMatchObject({ avg: 47.5, days: 2 });
  });

  it('averages samples per half hour on request', async () => {
    const { context } = toolSetup({ [BODY_BATTERY]: () => json(fixture('body-battery.json')) });
    const result = await getBodyBatteryTool.run({ include_samples: true }, context);
    expect(result.days[1]?.samples).toEqual([
      { time: '00:00', level: 30 },
      { time: '00:30', level: 34 },
      { time: '07:00', level: 70 },
      { time: '10:00', level: 62 },
    ]);
  });

  it("enforces Garmin's 31-day limit", async () => {
    const { context } = toolSetup({});
    await expect(
      getBodyBatteryTool.run({ start_date: '2026-01-01', end_date: '2026-02-01' }, context),
    ).rejects.toThrow(/at most 31 days/);
  });
});

describe('garmin_get_stress', () => {
  it('converts seconds to minutes and drops "not enough data" levels', async () => {
    const { context } = toolSetup({ [STRESS]: () => json(fixture('stress-range.json')) });
    const result = await getStressTool.run({}, context);
    expect(result.days).toEqual([
      {
        date: '2026-03-01',
        stress_avg: 24,
        rest_min: 720,
        low_min: 420,
        medium_min: 50,
        high_min: 10,
      },
      {
        date: '2026-03-02',
        stress_avg: null,
        rest_min: 360,
        low_min: 30,
        medium_min: 0,
        high_min: 0,
      },
    ]);
    expect(result.summary.stress_avg).toMatchObject({ avg: 24, days: 1 });
  });

  it("enforces Garmin's 28-day limit", async () => {
    const { context } = toolSetup({});
    await expect(
      getStressTool.run({ start_date: '2026-02-01', end_date: '2026-03-01' }, context),
    ).rejects.toThrow(/at most 28 days/);
  });
});

describe('garmin_get_steps', () => {
  it('returns steps, goal and distance with totals', async () => {
    const { context, paths } = toolSetup({ [STEPS]: () => json(fixture('steps-range.json')) });
    const result = await getStepsTool.run({ start_date: '2026-03-01' }, context);
    expect(paths()).toContain(`${STEPS}2026-03-01/2026-03-02`);
    expect(result.days[0]).toEqual({
      date: '2026-03-01',
      steps: 12000,
      goal: 10000,
      distance_km: 9.6,
    });
    expect(result.summary).toMatchObject({ total_steps: 15100, total_distance_km: 12 });
  });
});

describe('garmin_get_heart_rate', () => {
  it('returns resting, min, max and the 7-day resting average without samples', async () => {
    const { context, query } = toolSetup({ [HEART_RATE]: () => json(fixture('heart-rate.json')) });
    const result = await getHeartRateTool.run({}, context);
    expect(query(HEART_RATE)).toEqual({ date: '2026-03-02' });
    expect(result).toMatchObject({
      date: '2026-03-02',
      resting_hr_bpm: 47,
      min_hr_bpm: 44,
      max_hr_bpm: 152,
      resting_hr_7d_avg_bpm: 48,
      samples: null,
    });
  });

  it('averages samples per 15 minutes on request, skipping gaps', async () => {
    const { context } = toolSetup({ [HEART_RATE]: () => json(fixture('heart-rate.json')) });
    const result = await getHeartRateTool.run({ include_samples: true }, context);
    expect(result).toMatchObject({
      samples: [
        { time: '00:00', hr_bpm: 49 },
        { time: '00:15', hr_bpm: 46 },
        { time: '08:00', hr_bpm: 150 },
      ],
    });
  });

  it('reports no data for an empty day', async () => {
    const { context } = toolSetup({ [HEART_RATE]: () => json({ heartRateValues: null }) });
    expect(await getHeartRateTool.run({}, context)).toMatchObject({ no_data: true });
  });
});

describe('garmin_get_spo2', () => {
  it('returns averages and, on request, hourly SpO2 with altitude', async () => {
    const { context } = toolSetup({ [SPO2]: () => json(fixture('spo2.json')) });
    const result = await getSpo2Tool.run({ include_samples: true }, context);
    expect(result).toMatchObject({
      avg_pct: 95,
      lowest_pct: 88,
      avg_sleep_pct: 94,
      avg_7d_pct: 95.4,
      no_data: null,
      avg_altitude_m: 121,
      hourly: [
        { time: '00:00', spo2_pct: 95, altitude_m: 120 },
        { time: '01:00', spo2_pct: null, altitude_m: 122 },
      ],
    });
  });

  it('says when Pulse Ox recorded nothing', async () => {
    const { context } = toolSetup({
      [SPO2]: () => json({ averageSpO2: null, spO2HourlyAverages: [[1772402400000, null, 140]] }),
    });
    const result = await getSpo2Tool.run({}, context);
    expect(result).toMatchObject({ no_data: true, avg_altitude_m: 140, hourly: null });
  });
});

describe('garmin_get_fitness_age', () => {
  it('rounds the ages and flags stale components', async () => {
    const { context, paths } = toolSetup({
      [FITNESS_AGE]: () => json(fixture('fitness-age.json')),
    });
    const result = await getFitnessAgeTool.run({ date: '2026-03-01' }, context);
    expect(paths()).toContain(`${FITNESS_AGE}2026-03-01`);
    expect(result).toMatchObject({
      fitness_age: 38.4,
      chronological_age: 45,
      previous_fitness_age: 38.9,
      components: {
        resting_hr_bpm: { value: 48, stale: null },
        bmi: { value: 22.5, stale: true, measured_date: '2026-01-10' },
        vigorous_days_per_week: { value: 3.4 },
        vigorous_min_per_week: { value: 211 },
      },
      last_updated: '2026-03-02',
    });
  });
});

describe('garmin_get_heart_rate_zones', () => {
  it('returns the same zones as the profile tool', async () => {
    const { context } = toolSetup({ [HR_ZONES]: () => json(fixture('heart-rate-zones.json')) });
    const result = await getHeartRateZonesTool.run({}, context);
    expect(result.heart_rate_zones[0]?.zones).toHaveLength(5);
  });
});

describe('garmin_get_weight_goals', () => {
  it('converts the target to kg', async () => {
    const { context } = toolSetup({ [WEIGHT_GOALS]: () => json(fixture('weight-goals.json')) });
    const result = await getWeightGoalsTool.run({}, context);
    expect(result.goals).toEqual([
      {
        name: null,
        target_kg: 72,
        type: null,
        value: null,
        start_date: '2026-01-01',
        end_date: undefined,
      },
    ]);
    expect(result.no_data).toBeNull();
  });

  it('reports no goal for an empty response', async () => {
    const { context } = toolSetup({ [WEIGHT_GOALS]: empty });
    expect(await getWeightGoalsTool.run({}, context)).toMatchObject({ goals: [], no_data: true });
  });
});

describe('garmin_get_menstrual_cycle', () => {
  const SUMMARY = '/periodichealth-service/menstrualcycle/summary/';

  it('returns cycle day, windows and analysis, reading spec-style dates', async () => {
    const { context, paths } = toolSetup({
      [SUMMARY]: () => json(fixture('menstrual-summary.json')),
    });
    const result = await getMenstrualCycleTool.run({}, context);
    expect(paths()).toContain(`${SUMMARY}2026-03-02`);
    expect(result).toMatchObject({
      date: '2026-03-02',
      cycle_start_date: '2026-02-16',
      day_in_cycle: 15,
      phase_id: 2,
      period_length_days: 5,
      fertile_window: { from_day: 11, to_day: 16 },
      luteal_phase_start_day: 17,
      predicted_ovulation_date: '2026-03-02',
      uses_skin_temperature: true,
      analysis: { median_cycle_length_days: 29, cycle_variability_class: 'LOW' },
      pregnancy: null,
    });
  });

  it('reports no data for 204', async () => {
    const { context } = toolSetup({ [SUMMARY]: empty });
    expect(await getMenstrualCycleTool.run({}, context)).toMatchObject({ no_data: true });
  });
});

describe('garmin_get_menstrual_day', () => {
  const DAY = '/periodichealth-service/menstrualcycle/dayview/';

  it("returns the day's log without sexual activity fields, and today's date as reference", async () => {
    const { context, query } = toolSetup({ [DAY]: () => json(fixture('menstrual-dayview.json')) });
    const result = await getMenstrualDayTool.run({ date: '2026-02-17' }, context);
    expect(query(DAY)).toEqual({ todayDate: '2026-03-02' });
    expect(result).toMatchObject({
      date: '2026-02-17',
      logged: {
        flow: 'MEDIUM',
        symptoms: ['CRAMPS', 'FATIGUE'],
        moods: ['CALM'],
        discharge: null,
        ovulation_day: false,
      },
      cycle: { cycle_start_date: '2026-02-16', day_in_cycle: 2 },
    });
    const text = JSON.stringify(result);
    expect(text).not.toMatch(/sex/i);
    expect(text).not.toContain('userProfilePk');
  });

  it('reports no data for 204', async () => {
    const { context } = toolSetup({ [DAY]: empty });
    expect(await getMenstrualDayTool.run({}, context)).toMatchObject({ no_data: true });
  });
});

describe('garmin_get_hydration', () => {
  const HYDRATION = '/usersummary-service/stats/hydration/daily/';

  it('returns logged days in ml, sorted, without empty days', async () => {
    const { context } = toolSetup({ [HYDRATION]: () => json(fixture('hydration-range.json')) });
    const result = await getHydrationTool.run({}, context);
    expect(result.days).toEqual([
      {
        date: '2026-02-28',
        intake_ml: 1800,
        goal_ml: 3000,
        sweat_loss_ml: 0,
        activity_intake_ml: 0,
      },
      {
        date: '2026-03-01',
        intake_ml: 2250,
        goal_ml: 3000,
        sweat_loss_ml: 820,
        activity_intake_ml: 500,
      },
    ]);
    expect(result.summary?.intake_ml).toMatchObject({ avg: 2025, days: 2 });
  });

  it('reports no data for an empty list', async () => {
    const { context } = toolSetup({ [HYDRATION]: () => json([]) });
    expect(await getHydrationTool.run({}, context)).toMatchObject({ no_data: true });
  });
});

describe('garmin_get_wellness_activities', () => {
  it('returns local times, metrics and zones for string and spec-style timestamps', async () => {
    const { context } = toolSetup({
      '/wellnessactivity-service/': () => json(fixture('wellness-activities.json')),
    });
    const result = await getWellnessActivitiesTool.run({}, context);
    expect(result.activities).toEqual([
      {
        date: '2026-02-28',
        name: 'Breathwork',
        type: 'unknown',
        start: '2026-02-28T08:30:00+02:00',
        end: '2026-02-28T08:40:00+02:00',
        duration: '10:00',
        notes: undefined,
        metrics: { stress: { avg: 12, min: 5, max: 30 } },
        time_in_zones: [{ zone: 1, from: 0, minutes: 8 }],
      },
      expect.objectContaining({
        name: 'Health Snapshot',
        type: 'health_monitoring',
        start: '2026-03-01T21:00:00+02:00',
        duration: '2:00',
        metrics: {
          hr_bpm: { avg: 56.4, min: 52, max: 61 },
          hrv_rmssd_ms: { avg: 46.3, min: 38, max: 55 },
          spo2_pct: { avg: 96.7, min: 95, max: 98 },
        },
        time_in_zones: null,
      }),
    ]);
    const text = JSON.stringify(result);
    expect(text).not.toMatch(/device|uuid|userProfilePk/i);
    expectNoPrivateFields(result);
  });

  it('caps wellness activities at 92 days', async () => {
    const { context } = toolSetup({});
    await expect(
      getWellnessActivitiesTool.run({ start_date: '2025-11-01', end_date: '2026-03-01' }, context),
    ).rejects.toThrow(/at most 92 days/);
  });
});

describe('garmin_get_food_log', () => {
  const FOOD = '/nutrition-service/food/logs/';

  it('returns eaten vs. goals and meals with per-serving × servings totals', async () => {
    const { context } = toolSetup({ [FOOD]: () => json(fixture('food-log.json')) });
    const result = await getFoodLogTool.run({}, context);
    expect(result).toMatchObject({
      date: '2026-03-02',
      eaten: { calories_kcal: 1450, carbs_g: 190.5, protein_g: 72.3, fat_g: 41 },
      goals: { calories_kcal: 2400, adjusted_calories_kcal: 2950, adjusted_carbs_g: 370 },
      meals: [
        {
          name: 'Breakfast',
          calories_kcal: 650,
          foods: [
            {
              name: 'Oatmeal',
              servings: 2,
              serving: '40 g',
              time: '07:00',
              calories_kcal: 300,
              carbs_g: 54,
              protein_g: 10,
              fat_g: 6,
            },
          ],
        },
      ],
    });
    expect(result.meals).toHaveLength(1);
  });

  it('reports no food logged but keeps the goals', async () => {
    const { context } = toolSetup({
      [FOOD]: () =>
        json({ mealDate: '2026-03-02', dailyNutritionGoals: { calories: 2400 }, mealDetails: [] }),
    });
    expect(await getFoodLogTool.run({}, context)).toMatchObject({
      no_data: true,
      goals: { calories_kcal: 2400 },
    });
  });
});

describe('garmin_get_activity_workouts', () => {
  it("decodes Garmin's step encodings", async () => {
    const { context, paths } = toolSetup({
      '/activity-service/activity/': () => json(fixture('activity-workouts.json')),
    });
    const result = await getActivityWorkoutsTool.run({ activity_id: 123 }, context);
    expect(paths()).toContain('/activity-service/activity/123/workouts');
    expect(result.workouts?.[0]).toMatchObject({
      name: '6 x 800 m',
      sport: 'running',
      created: '2026-02-20',
      steps: [
        {
          step: 0,
          name: 'Warm up',
          type: 'warmup',
          ends: 'time',
          duration: '15:00',
          target: { hr_bpm: [130, 150] },
        },
        {
          step: 1,
          type: 'active',
          ends: 'distance',
          distance_m: 800,
          target: { pace_min_per_km: ['3:50', '4:00'] },
        },
        { step: 2, type: 'recovery', ends: 'time', duration_s: 120, target: null },
        { step: 3, type: 'repeat', repeat: { back_to_step: 1, times: 6 } },
        { step: 4, type: 'cooldown', ends: 'hr_below', hr_bpm: 130, target: { hr_zone: 2 } },
        {
          step: 5,
          ends: 'reps',
          reps: 10,
          exercise: { category: 'SQUAT', name: 'GOBLET_SQUAT' },
          weight_kg: 16,
          equipment: null,
        },
      ],
    });
  });

  it('reports no workout for an empty list', async () => {
    const { context } = toolSetup({ '/activity-service/activity/': () => json([]) });
    expect(await getActivityWorkoutsTool.run({ activity_id: 1 }, context)).toMatchObject({
      no_data: true,
    });
  });
});

describe('spec extras', () => {
  it('adds heart-rate alerts with thresholds', async () => {
    const { context } = toolSetup({
      [HEART_RATE]: () =>
        json({
          ...(fixture('heart-rate.json') as object),
          abnormalHrThresholdValue: 120,
          lowAbnormalHrThresholdValue: 40,
          abnormalHRValuesArray: [[1772431200000, 125]],
        }),
    });
    const result = await getHeartRateTool.run({}, context);
    expect(result).toMatchObject({
      abnormal_hr: {
        high_alert_bpm: 120,
        low_alert_bpm: 40,
        alerts: [{ time: '08:00', hr_bpm: 125 }],
      },
    });
  });

  it('adds achievable fitness age, and the reason when it is missing', async () => {
    const withAge = toolSetup({
      [FITNESS_AGE]: () =>
        json({ ...(fixture('fitness-age.json') as object), achievableFitnessAge: 33.15 }),
    });
    expect(await getFitnessAgeTool.run({}, withAge.context)).toMatchObject({
      achievable_fitness_age: 33.2,
    });
    const missing = toolSetup({ [FITNESS_AGE]: () => json({ invalidReason: 'USER_EMPTY_AGE' }) });
    expect(await getFitnessAgeTool.run({}, missing.context)).toMatchObject({
      no_data: true,
      note: expect.stringContaining('USER_EMPTY_AGE') as unknown,
    });
  });
});
