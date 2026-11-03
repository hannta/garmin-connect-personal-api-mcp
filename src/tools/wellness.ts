// All-day wellness range tools that mirror one Garmin endpoint each: Body Battery (with
// the events behind each day's charge and drain), stress-level minutes and steps.

import { z } from 'zod';
import { LIMITS, getBodyBatteryRange, getStepsRange, getStressRange } from '../garmin/endpoints';
import type { BodyBatteryDay, BodyBatteryFeedback, DailySteps, DailyStress } from '../garmin/types';
import { localIsoFromOffset } from '../lib/dates';
import { formatHoursMinutes, metersToKm, round } from '../lib/units';
import { defineTool } from './define';
import { rangeInput, resolveRange, summarize } from './range';
import { averagePerInterval } from './samples';
import { minutes, nonNegative } from './summaries';

type Maybe = number | null | undefined;

const SAMPLE_MINUTES = 30;

export interface BodyBatteryEventInput {
  type: string | null | undefined;
  start: string | null;
  durationMs: Maybe;
  impact: Maybe;
  shortFeedback: string | null | undefined;
}

/** One Body Battery event, e.g. a run: { type: "activity", start, duration, impact: -10 }. */
export function bodyBatteryEvent(event: BodyBatteryEventInput) {
  const durationSeconds = typeof event.durationMs === 'number' ? event.durationMs / 1000 : null;
  return {
    type: event.type?.toLowerCase(),
    start: event.start,
    duration: formatHoursMinutes(durationSeconds),
    duration_min: minutes(durationSeconds),
    impact: event.impact,
    feedback: event.shortFeedback === 'NONE' ? null : event.shortFeedback,
  };
}

export function bodyBatteryFeedback(feedback: BodyBatteryFeedback | null | undefined) {
  if (!feedback?.feedbackShortType) return null;
  return { level: feedback.bodyBatteryLevel, feedback: feedback.feedbackShortType };
}

function bodyBatteryRow(day: BodyBatteryDay, timeZone: string, includeSamples: boolean) {
  const samples = (day.bodyBatteryValuesArray ?? []).map(([at, value]) => ({ at, value }));
  return {
    date: day.date,
    charged: day.charged ?? null,
    drained: day.drained ?? null,
    events: (day.bodyBatteryActivityEvent ?? []).map((event) =>
      bodyBatteryEvent({
        type: event.eventType,
        start: localIsoFromOffset(event.eventStartTimeGmt, event.timezoneOffset),
        durationMs: event.durationInMilliseconds,
        impact: event.bodyBatteryImpact,
        shortFeedback: event.shortFeedback,
      }),
    ),
    feedback: bodyBatteryFeedback(day.bodyBatteryDynamicFeedbackEvent),
    end_of_day_feedback: bodyBatteryFeedback(day.endOfDayBodyBatteryDynamicFeedbackEvent),
    samples: includeSamples
      ? averagePerInterval(samples, timeZone, SAMPLE_MINUTES).map(({ time, value }) => ({
          time,
          level: value,
        }))
      : null,
  };
}

export const getBodyBatteryTool = defineTool({
  name: 'garmin_get_body_battery',
  title: 'Get Garmin Body Battery',
  description: [
    'Body Battery per day over a date range: how much it charged and drained, and the',
    'events behind it — sleep, each activity, rest and stress periods — with start time,',
    "duration, impact on Body Battery and Garmin's feedback.",
    `Set include_samples for the level through the day (averaged per ${SAMPLE_MINUTES} min).`,
    'For daily max / min Body Battery use garmin_get_daily_summaries.',
    `Defaults to the last 7 days; at most ${LIMITS.bodyBatteryRangeDays} days per call.`,
  ].join(' '),
  inputSchema: z.object({
    ...rangeInput(LIMITS.bodyBatteryRangeDays),
    include_samples: z
      .boolean()
      .optional()
      .describe(`Include levels averaged per ${SAMPLE_MINUTES} minutes. Default false.`),
  }),
  async run(input, context) {
    const zone = await context.timeZone();
    const range = await resolveRange(input, context, LIMITS.bodyBatteryRangeDays, 'Body Battery');
    const days = (await getBodyBatteryRange(context.client, range.start, range.end))
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((day) => bodyBatteryRow(day, zone.timeZone, input.include_samples ?? false));
    return {
      start_date: range.start,
      end_date: range.end,
      time_zone: zone.timeZone,
      days,
      summary: summarize(days, ['charged', 'drained']),
      warning: zone.warning,
    };
  },
});

function stressRow(day: DailyStress) {
  const values = day.values ?? {};
  return {
    date: day.calendarDate,
    stress_avg: nonNegative(values.overallStressLevel),
    rest_min: minutes(values.restStressDuration),
    low_min: minutes(values.lowStressDuration),
    medium_min: minutes(values.mediumStressDuration),
    high_min: minutes(values.highStressDuration),
  };
}

export const getStressTool = defineTool({
  name: 'garmin_get_stress',
  title: 'Get Garmin stress',
  description: [
    'All-day stress per day over a date range: average stress level (0–100) and minutes',
    'at rest (0–25), low (26–50), medium (51–75) and high (76–100) stress.',
    "Today's row is partial.",
    `Defaults to the last 7 days; at most ${LIMITS.stressRangeDays} days per call.`,
  ].join(' '),
  inputSchema: z.object(rangeInput(LIMITS.stressRangeDays)),
  async run(input, context) {
    const zone = await context.timeZone();
    const range = await resolveRange(input, context, LIMITS.stressRangeDays, 'Stress values');
    const days = (await getStressRange(context.client, range.start, range.end))
      .sort((a, b) => a.calendarDate.localeCompare(b.calendarDate))
      .map(stressRow);
    return {
      start_date: range.start,
      end_date: range.end,
      time_zone: zone.timeZone,
      days,
      summary: summarize(days, ['stress_avg', 'rest_min', 'high_min']),
      warning: zone.warning,
    };
  },
});

function stepsRow(day: DailySteps) {
  return {
    date: day.calendarDate,
    steps: day.totalSteps ?? null,
    goal: day.stepGoal ?? null,
    distance_km: metersToKm(day.totalDistance, 1),
  };
}

export const getStepsTool = defineTool({
  name: 'garmin_get_steps',
  title: 'Get Garmin steps',
  description: [
    'Steps per day over a date range, with the daily step goal and walking / running',
    "distance (km). Today's row is partial.",
    `Defaults to the last 7 days; at most ${LIMITS.stepsRangeDays} days per call.`,
  ].join(' '),
  inputSchema: z.object(rangeInput(LIMITS.stepsRangeDays)),
  async run(input, context) {
    const zone = await context.timeZone();
    const range = await resolveRange(input, context, LIMITS.stepsRangeDays, 'Steps');
    const days = (await getStepsRange(context.client, range.start, range.end))
      .sort((a, b) => a.calendarDate.localeCompare(b.calendarDate))
      .map(stepsRow);
    return {
      start_date: range.start,
      end_date: range.end,
      time_zone: zone.timeZone,
      days,
      summary: {
        ...summarize(days, ['steps', 'distance_km']),
        total_steps: total(days.map((day) => day.steps)),
        total_distance_km: round(total(days.map((day) => day.distance_km)), 1),
      },
      warning: zone.warning,
    };
  },
});

function total(values: Maybe[]): number | null {
  const present = values.filter((value): value is number => typeof value === 'number');
  return present.length > 0 ? present.reduce((sum, value) => sum + value, 0) : null;
}
