// Per-request context shared by the tools: the Garmin client, the clock, the user's
// time zone and first day of the week. The client is created lazily so `tools/list` works
// even before GARMIN_API_KEY is set; the profile is read once per request and cached in KV.

import type { GarminClient } from '../garmin/client';
import { getProfileSettings } from '../garmin/endpoints';
import type { KeyValueStore } from '../garmin/store';
import { isValidTimeZone, resolveTimeZone, todayIn, type ResolvedTimeZone } from '../lib/dates';

const PROFILE_KEY = 'garmin:profile:basics';
const PROFILE_TTL_SECONDS = 6 * 60 * 60;

export const WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** The profile settings the tools use, as cached in KV. */
interface ProfileBasics {
  timeZone: string | null;
  firstDayOfWeek: Weekday | null;
}

export interface ToolContext {
  readonly client: GarminClient;
  readonly store: KeyValueStore;
  now(): Date;
  timeZone(): Promise<ResolvedTimeZone>;
  /** Today's date (YYYY-MM-DD) in the user's time zone. */
  today(): Promise<string>;
  /** First day of the week from the Garmin profile; Monday if unknown. */
  firstDayOfWeek(): Promise<Weekday>;
}

export interface ToolContextOptions {
  client: () => GarminClient;
  store: KeyValueStore;
  /** The TIMEZONE var; empty or unset means "use the Garmin profile". */
  timeZoneOverride?: string | undefined;
  now?: () => Date;
}

export function createToolContext(options: ToolContextOptions): ToolContext {
  const now = options.now ?? (() => new Date());
  let client: GarminClient | undefined;
  let zone: Promise<ResolvedTimeZone> | undefined;
  let profile: Promise<ProfileBasics | null> | undefined;
  const readProfile = () => (profile ??= loadProfile(context, options.store));

  const context: ToolContext = {
    get client() {
      client ??= options.client();
      return client;
    },
    store: options.store,
    now,
    timeZone() {
      zone ??= resolveUserTimeZone(options, readProfile);
      return zone;
    },
    async today() {
      return todayIn((await context.timeZone()).timeZone, now());
    },
    async firstDayOfWeek() {
      return (await readProfile())?.firstDayOfWeek ?? 'monday';
    },
  };
  return context;
}

async function resolveUserTimeZone(
  options: ToolContextOptions,
  readProfile: () => Promise<ProfileBasics | null>,
): Promise<ResolvedTimeZone> {
  const override = options.timeZoneOverride?.trim();
  if (override && isValidTimeZone(override)) return resolveTimeZone({ override });
  const overrideWarning = override
    ? `TIMEZONE "${override}" is not a valid IANA time zone and was ignored.`
    : undefined;

  const resolved = resolveTimeZone({ profile: (await readProfile())?.timeZone });
  const warning = [overrideWarning, resolved.warning].filter(Boolean).join(' ');
  return warning ? { ...resolved, warning } : resolved;
}

/** Profile basics from KV, or from Garmin (then cached); null if Garmin fails. */
async function loadProfile(
  context: ToolContext,
  store: KeyValueStore,
): Promise<ProfileBasics | null> {
  const cached = await store.get(PROFILE_KEY);
  if (cached) {
    try {
      return JSON.parse(cached) as ProfileBasics;
    } catch {
      // Corrupt cache entry: read the profile again.
    }
  }
  try {
    const settings = await getProfileSettings(context.client);
    const dayName = settings.firstDayOfWeek?.dayName?.toLowerCase();
    const basics: ProfileBasics = {
      timeZone: settings.timeZone ?? null,
      firstDayOfWeek: WEEKDAYS.find((day) => day === dayName) ?? null,
    };
    if (basics.timeZone && isValidTimeZone(basics.timeZone)) {
      await store.put(PROFILE_KEY, JSON.stringify(basics), {
        expirationTtl: PROFILE_TTL_SECONDS,
      });
    }
    return basics;
  } catch {
    return null; // the time zone falls back to UTC with a warning
  }
}
