// Prints today's recovery data using the Garmin client and the key in .dev.vars.
// Usage: npm run today [-- YYYY-MM-DD]
// Never prints the API key or the access token.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GarminClient } from '../src/garmin/client';
import { getDailySummaries, getHrv, getProfileSettings, getSleep } from '../src/garmin/endpoints';
import { GarminError } from '../src/garmin/errors';
import { MemoryStore } from '../src/garmin/store';
import { TokenProvider } from '../src/garmin/token';
import { garminGmtToLocalIso, parseIsoDate, resolveTimeZone, todayIn } from '../src/lib/dates';
import { formatHoursMinutes } from '../src/lib/units';

function readDevVars(): Record<string, string> {
  const text = readFileSync(join(import.meta.dirname, '..', '.dev.vars'), 'utf8');
  const vars: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match?.[1]) vars[match[1]] = (match[2] ?? '').replace(/^["']|["']$/g, '');
  }
  return vars;
}

async function settle<T>(promise: Promise<T>): Promise<T | string> {
  try {
    return await promise;
  } catch (error) {
    return error instanceof GarminError ? `(${error.code}) ${error.message}` : String(error);
  }
}

async function main(): Promise<void> {
  const vars = readDevVars();
  const tokens = new TokenProvider({ apiKey: vars.GARMIN_API_KEY, store: new MemoryStore() });
  const client = new GarminClient({ tokens });

  const profile = await getProfileSettings(client);
  const zone = resolveTimeZone({ override: vars.TIMEZONE, profile: profile.timeZone });
  const date = process.argv[2] ? parseIsoDate(process.argv[2]) : todayIn(zone.timeZone);

  const [summaries, sleep, hrv] = await Promise.all([
    settle(getDailySummaries(client, date, date)),
    settle(getSleep(client, date)),
    settle(getHrv(client, date)),
  ]);

  console.log(`Date ${date} (time zone ${zone.timeZone}, from ${zone.source})`);
  if (zone.warning) console.log(`Warning: ${zone.warning}`);

  if (typeof summaries === 'string') console.log(`Daily summary: ${summaries}`);
  else {
    const day = summaries[0];
    console.log('Daily summary:', {
      resting_hr_bpm: day?.heartRate?.restingValue ?? null,
      body_battery_latest: day?.bodyBattery?.latestValue ?? null,
      body_battery_max: day?.bodyBattery?.maxValue ?? null,
      stress_avg: day?.stress?.avgLevel ?? null,
      intensity_minutes: {
        moderate: day?.intensityMinutes?.moderate ?? null,
        vigorous: day?.intensityMinutes?.vigorous ?? null,
      },
    });
  }

  if (typeof sleep === 'string') console.log(`Sleep: ${sleep}`);
  else {
    console.log('Sleep (night ending on this date):', {
      score: sleep.sleepScores?.overall?.value ?? null,
      duration: formatHoursMinutes(sleep.sleepTimeSeconds),
      deep: formatHoursMinutes(sleep.deepSleepSeconds),
      rem: formatHoursMinutes(sleep.remSleepSeconds),
      start: garminGmtToLocalIso(sleep.sleepStartTimestampGMT, zone.timeZone),
      end: garminGmtToLocalIso(sleep.sleepEndTimestampGMT, zone.timeZone),
    });
  }

  if (typeof hrv === 'string') console.log(`HRV: ${hrv}`);
  else {
    const summary = hrv.hrvSummary;
    console.log('HRV:', {
      last_night_avg_ms: summary?.lastNightAvg ?? null,
      weekly_avg_ms: summary?.weeklyAvg ?? null,
      balanced_range_ms: summary?.baseline
        ? [summary.baseline.balancedLow, summary.baseline.balancedUpper]
        : null,
      status: summary?.status ?? null,
    });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : error);
  process.exitCode = 1;
});
