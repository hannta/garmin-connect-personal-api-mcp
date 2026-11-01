import { z } from 'zod';
import { getHeartRateZones, getProfileSettings } from '../garmin/endpoints';
import type { HeartRateZones, ProfileSettings } from '../garmin/types';
import type { ResolvedTimeZone } from '../lib/dates';
import { defineTool } from './define';

export const getProfileTool = defineTool({
  name: 'garmin_get_profile',
  title: 'Get Garmin profile and HR zones',
  description: [
    "The user's Garmin settings and heart-rate zones: time zone used for dates,",
    'first day of the week, and per-sport HR zones with max, resting and lactate-threshold',
    'heart rate. Use it to interpret heart-rate data from the other tools.',
  ].join(' '),
  inputSchema: z.object({}),
  async run(_input, context) {
    const [settings, zones, zone] = await Promise.all([
      getProfileSettings(context.client),
      getHeartRateZones(context.client),
      context.timeZone(),
    ]);
    return formatProfile(settings, zones, zone);
  },
});

function formatZones(zones: HeartRateZones) {
  const floors = [
    zones.zone1Floor,
    zones.zone2Floor,
    zones.zone3Floor,
    zones.zone4Floor,
    zones.zone5Floor,
  ];
  if (floors.some((floor) => typeof floor !== 'number')) return null;
  return floors.map((floor, index) => {
    const next = floors[index + 1];
    return {
      zone: index + 1,
      from_bpm: floor,
      to_bpm: typeof next === 'number' ? next - 1 : zones.maxHeartRateUsed,
    };
  });
}

export function formatProfile(
  settings: ProfileSettings,
  zones: HeartRateZones[],
  zone: ResolvedTimeZone,
) {
  return {
    time_zone: zone.timeZone,
    time_zone_source: zone.source,
    garmin_profile_time_zone: settings.timeZone,
    first_day_of_week: settings.firstDayOfWeek?.dayName?.toLowerCase(),
    units: 'metric',
    heart_rate_zones: zones.map((sport) => ({
      sport: sport.sport?.toLowerCase(),
      method: sport.trainingMethod,
      max_hr_bpm: sport.maxHeartRateUsed,
      // Garmin sends 0 when the zone method doesn't use resting HR.
      resting_hr_bpm: sport.restingHeartRateUsed || null,
      lactate_threshold_hr_bpm: sport.lactateThresholdHeartRateUsed,
      zones: formatZones(sport),
    })),
    warning: zone.warning,
  };
}
