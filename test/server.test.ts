import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { describe, expect, it, vi } from 'vitest';
import packageJson from '../package.json';
import { GarminError } from '../src/garmin/errors';
import { MemoryStore } from '../src/garmin/store';
import { createServer } from '../src/server';
import { compact, errorMessage, runTool } from '../src/tools/result';
import { NOW_MS, TEST_KEY, fixture, json, routedFetch } from './helpers';

const TOOL_NAMES = [
  'garmin_get_activity',
  'garmin_get_activity_laps',
  'garmin_get_activity_streams',
  'garmin_get_activity_workouts',
  'garmin_get_body_battery',
  'garmin_get_daily_summaries',
  'garmin_get_day',
  'garmin_get_days',
  'garmin_get_fitness_age',
  'garmin_get_food_log',
  'garmin_get_heart_rate',
  'garmin_get_heart_rate_zones',
  'garmin_get_hrv',
  'garmin_get_hrv_summaries',
  'garmin_get_hydration',
  'garmin_get_menstrual_cycle',
  'garmin_get_menstrual_day',
  'garmin_get_profile',
  'garmin_get_sleep',
  'garmin_get_sleep_summaries',
  'garmin_get_spo2',
  'garmin_get_steps',
  'garmin_get_stress',
  'garmin_get_weight',
  'garmin_get_weight_goals',
  'garmin_get_wellness_activities',
  'garmin_search_activities',
];

function testEnv(overrides: Partial<Env> = {}): Env {
  return {
    GARMIN_API_KEY: TEST_KEY,
    GARMIN_KV: new MemoryStore(() => NOW_MS) as unknown as KVNamespace,
    OAUTH_KV: new MemoryStore(() => NOW_MS) as unknown as KVNamespace,
    OWNER_PASSPHRASE: 'unused',
    ...overrides,
  };
}

const garminRoutes = () =>
  routedFetch({
    '/userprofile-service/': () => json(fixture('profile-settings.json')),
    '/biometric-service/': () => json(fixture('heart-rate-zones.json')),
  });

async function connect(
  env: Env,
  fetchFn?: typeof fetch,
  apiKey: () => string | undefined = () => env.GARMIN_API_KEY,
) {
  const server = createServer({
    apiKey,
    store: env.GARMIN_KV,
    timeZone: env.TIMEZONE,
    ...(fetchFn && { fetch: fetchFn }),
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(clientTransport);
  return client;
}

function text(result: { content: unknown }): string {
  const [first] = result.content as { type: string; text: string }[];
  return first?.text ?? '';
}

describe('result helpers', () => {
  it('compacts nulls, blank strings and empty objects but keeps zeros', () => {
    expect(
      compact({ a: null, b: ' name ', c: '', d: { e: undefined }, f: [1, null], g: 0, h: false }),
    ).toEqual({ b: 'name', f: [1, null], g: 0, h: false });
  });

  it('explains key problems without leaking details', () => {
    const message = errorMessage(new GarminError('invalid_key', 'Garmin rejected the API key.'));
    expect(message).toMatch(/GARMIN_API_KEY/);
    expect(errorMessage(new Error(`secret ${TEST_KEY}`))).not.toContain(TEST_KEY);
  });

  it('turns thrown errors into tool errors', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = await runTool(() => Promise.reject(new Error('boom')));
    expect(result.isError).toBe(true);
    expect(text(result)).toBe('Unexpected error while reading Garmin data.');
  });
});

describe('MCP server', () => {
  it('reports the package.json version to clients', async () => {
    const client = await connect(testEnv());
    expect(client.getServerVersion()).toMatchObject({
      name: 'garmin-connect-personal-api-mcp',
      version: packageJson.version,
    });
  });

  it('declares its icon', async () => {
    const client = await connect(testEnv());
    const icons = client.getServerVersion()?.icons ?? [];
    expect(icons.map((icon) => icon.mimeType)).toEqual(['image/png', 'image/svg+xml']);
    for (const icon of icons) {
      const file = new URL(icon.src).pathname.split('/').pop() ?? '';
      expect(existsSync(join(import.meta.dirname, '..', 'assets', file))).toBe(true);
    }
  });

  it('lists every tool as read-only', async () => {
    const client = await connect(testEnv());
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(TOOL_NAMES);
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint).toBe(true);
      expect(tool.description).toBeTruthy();
    }
  });

  it('calls a tool and returns compact JSON', async () => {
    const client = await connect(testEnv(), garminRoutes().fetch);
    const result = await client.callTool({ name: 'garmin_get_profile', arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(text(result))).toMatchObject({ time_zone: 'Europe/Helsinki' });
  });

  it('rejects invalid input before calling Garmin', async () => {
    const mock = garminRoutes();
    const client = await connect(testEnv(), mock.fetch);
    const result = await client.callTool({ name: 'garmin_get_sleep', arguments: { date: 'x' } });
    expect(result.isError).toBe(true);
    expect(mock.calls).toHaveLength(0);
  });

  it('reports a missing API key as a tool error', async () => {
    const client = await connect(testEnv({ GARMIN_API_KEY: '' }));
    const result = await client.callTool({ name: 'garmin_get_profile', arguments: {} });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/No Garmin API key is set/);
  });

  it('reads the key on every call, so a new key works without a restart', async () => {
    const apiKey = vi.fn<() => string | undefined>();
    const client = await connect(testEnv(), garminRoutes().fetch, apiKey);
    const before = await client.callTool({ name: 'garmin_get_profile', arguments: {} });
    expect(before.isError).toBe(true);
    apiKey.mockReturnValue(TEST_KEY);
    const after = await client.callTool({ name: 'garmin_get_profile', arguments: {} });
    expect(after.isError).toBeFalsy();
  });
});
