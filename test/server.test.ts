import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { describe, expect, it, vi } from 'vitest';
import { GarminError } from '../src/garmin/errors';
import { MemoryStore } from '../src/garmin/store';
import worker from '../src/index';
import { createServer } from '../src/server';
import { compact, errorMessage, runTool } from '../src/tools/result';
import { NOW_MS, TEST_KEY, fixture, json, routedFetch } from './helpers';

const TOOL_NAMES = [
  'garmin_get_activity',
  'garmin_get_day',
  'garmin_get_hrv',
  'garmin_get_profile',
  'garmin_get_sleep',
  'garmin_search_activities',
];

function testEnv(overrides: Partial<Env> = {}): Env {
  return {
    GARMIN_API_KEY: TEST_KEY,
    GARMIN_KV: new MemoryStore(() => NOW_MS) as unknown as KVNamespace,
    OAUTH_KV: new MemoryStore(() => NOW_MS) as unknown as KVNamespace,
    OWNER_PASSPHRASE: 'unused',
    COOKIE_ENCRYPTION_KEY: 'unused',
    ...overrides,
  };
}

const garminRoutes = () =>
  routedFetch({
    '/userprofile-service/': () => json(fixture('profile-settings.json')),
    '/biometric-service/': () => json(fixture('heart-rate-zones.json')),
  });

async function connect(env: Env, fetchFn?: typeof fetch) {
  const server = createServer(env, { ...(fetchFn && { fetch: fetchFn }) });
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
  it('lists the six read-only tools', async () => {
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
    expect(text(result)).toMatch(/GARMIN_API_KEY is not set/);
  });
});

describe('Worker entry', () => {
  const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined };
  // Node's Request doesn't add a Host header like the Workers runtime does.
  const call = (url: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set('host', new URL(url).host);
    return worker.fetch(
      new Request(url, { ...init, headers }) as Parameters<typeof worker.fetch>[0],
      testEnv(),
      ctx as unknown as ExecutionContext,
    );
  };
  const listTools = {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-06-18',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  };

  it('serves MCP on localhost', async () => {
    const response = await call('http://localhost:8787/mcp', listTools);
    expect(response.status).toBe(200);
    const body = await response.text();
    for (const name of TOOL_NAMES) expect(body).toContain(name);
  });

  it('refuses MCP on other hosts until OAuth exists', async () => {
    const response = await call('https://garmin.example.workers.dev/mcp', listTools);
    expect(response.status).toBe(403);
  });

  it('answers / and 404s anything else', async () => {
    expect((await call('http://localhost/')).status).toBe(200);
    expect((await call('http://localhost/nope')).status).toBe(404);
  });
});
