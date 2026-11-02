// Garmin-downsampled time series for one activity (`/details`), as columns + rows to
// keep the output small. No FIT decoding, so it fits the free plan's CPU limit.
// Location channels are never returned.

import { z } from 'zod';
import { getActivityStreams } from '../garmin/endpoints';
import type { ActivityStreams } from '../garmin/types';
import { round, speedToKmh, speedToPace } from '../lib/units';
import { defineTool } from './define';

type Value = number | string | null;

interface Channel {
  /** Output column name, with its unit. */
  column: string;
  /** Garmin metric keys, first present wins. */
  keys: string[];
  convert: (value: number) => Value;
}

const same = (value: number) => round(value, 1);

const CHANNELS = {
  hr: { column: 'hr_bpm', keys: ['directHeartRate'], convert: same },
  pace: { column: 'pace_min_per_km', keys: ['directSpeed'], convert: speedToPace },
  grade_adjusted_pace: {
    column: 'grade_adjusted_pace_min_per_km',
    keys: ['directGradeAdjustedSpeed'],
    convert: speedToPace,
  },
  speed: { column: 'speed_kmh', keys: ['directSpeed'], convert: speedToKmh },
  cadence: {
    column: 'cadence_spm',
    keys: ['directDoubleCadence', 'directBikeCadence'],
    convert: same,
  },
  power: { column: 'power_w', keys: ['directPower'], convert: same },
  elevation: { column: 'elevation_m', keys: ['directElevation'], convert: same },
  ground_contact_time: { column: 'gct_ms', keys: ['directGroundContactTime'], convert: same },
  vertical_oscillation: {
    column: 'vertical_oscillation_cm',
    keys: ['directVerticalOscillation'],
    convert: same,
  },
  vertical_ratio: { column: 'vertical_ratio_pct', keys: ['directVerticalRatio'], convert: same },
  stride_length: {
    column: 'stride_length_m',
    keys: ['directStrideLength'],
    convert: (cm: number) => round(cm / 100, 2),
  },
  respiration: { column: 'respiration_brpm', keys: ['directRespirationRate'], convert: same },
  temperature: { column: 'temperature_c', keys: ['directAirTemperature'], convert: same },
  stamina: { column: 'stamina_pct', keys: ['directAvailableStamina'], convert: same },
  performance_condition: {
    column: 'performance_condition',
    keys: ['directPerformanceCondition'],
    convert: same,
  },
  body_battery: { column: 'body_battery', keys: ['directBodyBattery'], convert: same },
} satisfies Record<string, Channel>;

type ChannelName = keyof typeof CHANNELS;
const CHANNEL_NAMES = Object.keys(CHANNELS) as [ChannelName, ...ChannelName[]];
const DEFAULT_CHANNELS: ChannelName[] = [
  'hr',
  'pace',
  'grade_adjusted_pace',
  'cadence',
  'power',
  'elevation',
];

/** Always first: where in the activity each row is. */
const POSITION: Channel[] = [
  { column: 'distance_km', keys: ['sumDistance'], convert: (m) => round(m / 1000, 2) },
  { column: 'time_s', keys: ['sumElapsedDuration'], convert: (s) => round(s) },
];

const DEFAULT_POINTS = 100;
const MAX_POINTS = 300;

export const getActivityStreamsTool = defineTool({
  name: 'garmin_get_activity_streams',
  title: 'Get Garmin activity streams',
  description: [
    'Time series for one activity, downsampled by Garmin to about `points` rows, for',
    'questions like "did my HR drift in the last 10 km?" or "where did my pace fade?".',
    'Returns `columns` and `rows`; each row starts with distance (km) and elapsed time (s).',
    `Default channels: ${DEFAULT_CHANNELS.join(', ')}; channels the activity didn't record`,
    'are left out. Use speed instead of pace for cycling. Location is never returned.',
    'Get the activity id from garmin_search_activities.',
  ].join(' '),
  inputSchema: z.object({
    activity_id: z.number().int().positive().describe('Garmin activity ID.'),
    channels: z
      .array(z.enum(CHANNEL_NAMES))
      .min(1)
      .optional()
      .describe(`Channels to include. Default: ${DEFAULT_CHANNELS.join(', ')}.`),
    points: z
      .number()
      .int()
      .min(10)
      .max(MAX_POINTS)
      .optional()
      .describe(`Approximate number of rows (default ${DEFAULT_POINTS}, max ${MAX_POINTS}).`),
  }),
  async run(input, context) {
    const streams = await getActivityStreams(
      context.client,
      input.activity_id,
      input.points ?? DEFAULT_POINTS,
    );
    const channels = (input.channels ?? DEFAULT_CHANNELS).map((name) => CHANNELS[name]);
    return { activity_id: input.activity_id, ...formatStreams(streams, channels) };
  },
});

export function formatStreams(streams: ActivityStreams, channels: Channel[]) {
  const index = new Map(
    (streams.metricDescriptors ?? []).map((descriptor) => [
      descriptor.key,
      descriptor.metricsIndex,
    ]),
  );
  const rows = streams.activityDetailMetrics ?? [];
  // Resolve each channel to its column index; drop channels without any data.
  const columns = [...POSITION, ...channels]
    .map((channel) => {
      const key = channel.keys.find((candidate) => index.has(candidate));
      return key === undefined ? null : { channel, at: index.get(key) ?? -1 };
    })
    .filter((column): column is { channel: Channel; at: number } => column !== null)
    .filter(({ at }) => rows.some((row) => typeof row.metrics[at] === 'number'));

  if (rows.length === 0 || columns.length === 0) {
    return { no_data: true, note: 'Garmin has no time series for this activity.' };
  }
  return {
    points: rows.length,
    columns: columns.map(({ channel }) => channel.column),
    rows: rows.map((row) =>
      columns.map(({ channel, at }) => {
        const value = row.metrics[at];
        return typeof value === 'number' ? channel.convert(value) : null;
      }),
    ),
  };
}
