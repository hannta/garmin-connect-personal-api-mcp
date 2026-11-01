// Per-request context shared by the tools: the Garmin client, the clock and the user's
// time zone. The client is created lazily so `tools/list` works even before
// GARMIN_API_KEY is set; the time zone is resolved once per request and cached in KV.

import type { GarminClient } from '../garmin/client';
import { getProfileSettings } from '../garmin/endpoints';
import type { KeyValueStore } from '../garmin/store';
import { isValidTimeZone, resolveTimeZone, todayIn, type ResolvedTimeZone } from '../lib/dates';

const TIME_ZONE_KEY = 'garmin:profile:timezone';
const TIME_ZONE_TTL_SECONDS = 6 * 60 * 60;

export interface ToolContext {
  readonly client: GarminClient;
  now(): Date;
  timeZone(): Promise<ResolvedTimeZone>;
  /** Today's date (YYYY-MM-DD) in the user's time zone. */
  today(): Promise<string>;
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

  const context: ToolContext = {
    get client() {
      client ??= options.client();
      return client;
    },
    now,
    timeZone() {
      zone ??= resolveUserTimeZone(context, options);
      return zone;
    },
    async today() {
      return todayIn((await context.timeZone()).timeZone, now());
    },
  };
  return context;
}

async function resolveUserTimeZone(
  context: ToolContext,
  options: ToolContextOptions,
): Promise<ResolvedTimeZone> {
  const override = options.timeZoneOverride?.trim();
  if (override && isValidTimeZone(override)) return resolveTimeZone({ override });
  const overrideWarning = override
    ? `TIMEZONE "${override}" is not a valid IANA time zone and was ignored.`
    : undefined;

  let profile = await options.store.get(TIME_ZONE_KEY);
  if (!profile) {
    try {
      profile = (await getProfileSettings(context.client)).timeZone ?? null;
      if (profile && isValidTimeZone(profile)) {
        await options.store.put(TIME_ZONE_KEY, profile, {
          expirationTtl: TIME_ZONE_TTL_SECONDS,
        });
      }
    } catch {
      profile = null; // fall through to UTC with a warning
    }
  }

  const resolved = resolveTimeZone({ profile });
  const warning = [overrideWarning, resolved.warning].filter(Boolean).join(' ');
  return warning ? { ...resolved, warning } : resolved;
}
