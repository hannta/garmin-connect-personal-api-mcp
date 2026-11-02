import { z } from 'zod';
import { LIMITS, searchActivities } from '../garmin/endpoints';
import type { ActivitySummary } from '../garmin/types';
import { DateInputError, addDays, weekStart } from '../lib/dates';
import { formatDuration, formatHoursMinutes, metersToKm, round } from '../lib/units';
import { WEEKDAYS } from './context';
import { dateInput, defineTool } from './define';
import { activityRow } from './format';
import { summarize } from './range';

const DEFAULT_DAYS = 7;

export const searchActivitiesTool = defineTool({
  name: 'garmin_search_activities',
  title: 'Search Garmin activities',
  description: [
    'List Garmin activities in a date range, newest first: ID, type, local start time,',
    'distance, duration, pace (or speed), average / max heart rate, elevation gain,',
    'training effect, training load and fastest splits (1 km … marathon, when long enough).',
    `Defaults to the last ${DEFAULT_DAYS} days. Use the returned id with`,
    'garmin_get_activity for heart-rate zones, running dynamics, intervals and RPE.',
    'With group_by "week", returns totals per week instead (count, distance, time,',
    'elevation, training load, minutes per HR zone, longest activity; `summary` covers',
    'full weeks only), for volume over a training block. Weekly totals cover up to',
    `${LIMITS.activitySearchMaxResults} activities per call.`,
  ].join(' '),
  inputSchema: z.object({
    start_date: dateInput(
      `First day, YYYY-MM-DD in the user's time zone. Default: ${DEFAULT_DAYS - 1} days before end_date.`,
    ),
    end_date: dateInput(
      "Last day (inclusive), YYYY-MM-DD. Default: today in the user's time zone.",
    ),
    activity_type: z
      .string()
      .regex(/^[a-z_]+$/)
      .optional()
      .describe(
        'Garmin activity type key, e.g. running, trail_running, treadmill_running, cycling, road_biking, walking, hiking, strength_training, lap_swimming.',
      ),
    group_by: z
      .enum(['week'])
      .optional()
      .describe(
        "Return weekly totals instead of activities. Weeks start on the user's first day of the week; limit and offset don't apply.",
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(LIMITS.activitySearchMaxResults)
      .optional()
      .describe(`Maximum activities to return (default ${LIMITS.activitySearchDefaultResults}).`),
    offset: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Skip this many activities, for paging with next_offset.'),
  }),
  async run(input, context) {
    const zone = await context.timeZone();
    const end = input.end_date ?? (await context.today());
    const start = input.start_date ?? addDays(end, -(DEFAULT_DAYS - 1));

    if (input.group_by === 'week') {
      const limit = LIMITS.activitySearchMaxResults;
      const activities = await searchActivities(context.client, {
        start,
        end,
        activityType: input.activity_type,
        limit,
      });
      if (activities.length >= limit) {
        throw new DateInputError(
          `${start} – ${end} has ${limit} or more activities, more than weekly totals cover in one call. Split the range.`,
        );
      }
      const firstDay = await context.firstDayOfWeek();
      const weeks = weeklyTotals(activities, start, end, WEEKDAYS.indexOf(firstDay));
      return {
        start_date: start,
        end_date: end,
        time_zone: zone.timeZone,
        activity_type: input.activity_type,
        first_day_of_week: firstDay,
        weeks,
        // Full weeks only: a partial first or last week would pull the averages down.
        summary: summarize(
          weeks.filter((week) => !week.partial),
          ['activity_count', 'distance_km', 'duration_min', 'elevation_gain_m', 'training_load'],
        ),
        warning: zone.warning,
      };
    }

    const limit = input.limit ?? LIMITS.activitySearchDefaultResults;
    const offset = input.offset ?? 0;
    const activities = await searchActivities(context.client, {
      start,
      end,
      activityType: input.activity_type,
      limit,
      offset,
    });

    return {
      start_date: start,
      end_date: end,
      time_zone: zone.timeZone,
      count: activities.length,
      activities: activities.map(activityRow),
      next_offset: activities.length === limit ? offset + limit : null,
      warning: zone.warning,
    };
  },
});

/** One row per week touching the range, oldest first, including weeks without activities. */
export function weeklyTotals(
  activities: ActivitySummary[],
  start: string,
  end: string,
  firstDay: number,
) {
  const weeks = [];
  for (let week = weekStart(start, firstDay); week <= end; week = addDays(week, 7)) {
    const weekEnd = addDays(week, 6);
    const inWeek = activities.filter((activity) => {
      const date = activity.startTimeLocal?.slice(0, 10) ?? '';
      return date >= week && date <= weekEnd;
    });
    weeks.push({
      week_start: week,
      // The first or last week can extend past the requested range.
      partial: week < start || weekEnd > end ? true : null,
      ...weekRow(inWeek),
    });
  }
  return weeks;
}

function weekRow(activities: ActivitySummary[]) {
  const sum = (pick: (activity: ActivitySummary) => number | null | undefined) =>
    activities.reduce((total, activity) => total + (pick(activity) ?? 0), 0);
  const types: Record<string, number> = {};
  for (const activity of activities) {
    const type = activity.activityType?.typeKey ?? 'other';
    types[type] = (types[type] ?? 0) + 1;
  }
  const longest = activities.reduce<ActivitySummary | undefined>(
    (best, activity) =>
      !best || (activity.distance ?? 0) > (best.distance ?? 0) ? activity : best,
    undefined,
  );
  const zoneSeconds = [
    sum((activity) => activity.hrTimeInZone_1),
    sum((activity) => activity.hrTimeInZone_2),
    sum((activity) => activity.hrTimeInZone_3),
    sum((activity) => activity.hrTimeInZone_4),
    sum((activity) => activity.hrTimeInZone_5),
  ];
  const duration = sum((activity) => activity.duration);
  return {
    activity_count: activities.length,
    types: activities.length > 0 ? types : null,
    distance_km: round(sum((activity) => activity.distance) / 1000, 1),
    duration: formatHoursMinutes(duration),
    duration_min: round(duration / 60),
    elevation_gain_m: round(sum((activity) => activity.elevationGain)),
    training_load: round(sum((activity) => activity.activityTrainingLoad)),
    hr_zone_min: zoneSeconds.some((seconds) => seconds > 0)
      ? zoneSeconds.map((seconds) => round(seconds / 60))
      : null,
    longest:
      longest && (longest.distance ?? 0) > 0
        ? {
            id: longest.activityId,
            date: longest.startTimeLocal?.slice(0, 10),
            type: longest.activityType?.typeKey,
            distance_km: metersToKm(longest.distance),
            duration: formatDuration(longest.duration),
          }
        : null,
  };
}
