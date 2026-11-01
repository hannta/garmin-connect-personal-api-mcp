import { z } from 'zod';
import { LIMITS, searchActivities } from '../garmin/endpoints';
import { addDays } from '../lib/dates';
import { activityRow } from './format';
import { dateInput, defineTool } from './define';

const DEFAULT_DAYS = 7;

export const searchActivitiesTool = defineTool({
  name: 'garmin_search_activities',
  title: 'Search Garmin activities',
  description: [
    'List Garmin activities in a date range, newest first: ID, type, local start time,',
    'distance, duration, pace (or speed), average / max heart rate, elevation gain,',
    'training effect and training load.',
    `Defaults to the last ${DEFAULT_DAYS} days. Use the returned id with`,
    'garmin_get_activity for heart-rate zones, running dynamics, intervals and RPE.',
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
