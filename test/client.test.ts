import { describe, expect, it } from 'vitest';
import { GarminClient } from '../src/garmin/client';
import { GarminError } from '../src/garmin/errors';
import { MemoryStore } from '../src/garmin/store';
import { TokenProvider } from '../src/garmin/token';
import { NOW_MS, TEST_KEY, json, makeClient, mockFetch } from './helpers';

/**
 * A client with a 20 ms time limit whose data requests go to `respond`, which gets the
 * request's abort signal the way a real fetch does. Token requests answer at once.
 */
function clientWithTimeout(respond: (signal: AbortSignal) => Promise<Response>) {
  const mock = mockFetch([]);
  let dataCalls = 0;
  const fetchFn = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (url.endsWith('/personal-api-key/token')) return mock.fetch(input, init);
    dataCalls += 1;
    if (!init?.signal) throw new Error('Request without a signal');
    return respond(init.signal);
  }) as typeof fetch;
  const store = new MemoryStore(() => NOW_MS);
  const tokens = new TokenProvider({ apiKey: TEST_KEY, store, fetch: fetchFn, now: () => NOW_MS });
  const client = new GarminClient({
    tokens,
    fetch: fetchFn,
    sleep: () => Promise.resolve(),
    timeoutMs: 20,
  });
  return { client, dataCalls: () => dataCalls };
}

const aborted = (signal: AbortSignal) =>
  new Promise<never>((_, reject) => {
    signal.addEventListener('abort', () => {
      reject(signal.reason as Error);
    });
  });

describe('GarminClient', () => {
  it('sends a bearer token and builds the query, skipping undefined values', async () => {
    const mock = mockFetch([() => json({ ok: true })]);
    const { client } = makeClient(mock.fetch);

    await client.getJson('/x/y', { a: '1', b: 2, c: undefined });

    const call = mock.dataCalls()[0];
    expect(call?.url.toString()).toBe('https://personal.connectapi.garmin.com/x/y?a=1&b=2');
    expect(call?.authorization).toMatch(/^Bearer [\w-]+\.[\w-]+\.sig$/);
  });

  it('refreshes the token once on 401 and retries', async () => {
    const mock = mockFetch([() => json({}, 401), () => json({ ok: true })]);
    const { client } = makeClient(mock.fetch);

    await expect(client.getJson('/x')).resolves.toEqual({ ok: true });
    expect(mock.tokenCalls()).toHaveLength(2);
    const [first, second] = mock.dataCalls();
    expect(first?.authorization).not.toBe(second?.authorization);
  });

  it('gives up after a second 401', async () => {
    const mock = mockFetch([() => json({}, 401), () => json({}, 401)]);
    const { client } = makeClient(mock.fetch);

    await expect(client.getJson('/x', {}, 'sleep for 2026-03-02')).rejects.toMatchObject({
      code: 'unauthorized',
      message: expect.stringContaining('sleep for 2026-03-02') as unknown,
    });
  });

  it('retries once on 503, then succeeds', async () => {
    const mock = mockFetch([() => json({}, 503), () => json({ ok: true })]);
    const { client } = makeClient(mock.fetch);

    await expect(client.getJson('/x')).resolves.toEqual({ ok: true });
    expect(mock.dataCalls()).toHaveLength(2);
  });

  it('retries once on a network error', async () => {
    const mock = mockFetch([
      () => {
        throw new TypeError('fetch failed');
      },
      () => json({ ok: true }),
    ]);
    const { client } = makeClient(mock.fetch);

    await expect(client.getJson('/x')).resolves.toEqual({ ok: true });
  });

  it('maps 404 to not_found without retrying', async () => {
    const mock = mockFetch([() => json({ error: 'NOT_FOUND', status: 404 }, 404)]);
    const { client } = makeClient(mock.fetch);

    await expect(client.getJson('/x')).rejects.toMatchObject({ code: 'not_found', status: 404 });
    expect(mock.dataCalls()).toHaveLength(1);
  });

  it('maps 429 to rate_limited with Retry-After, without retrying', async () => {
    const mock = mockFetch([() => json({}, 429, { 'retry-after': '30' })]);
    const { client } = makeClient(mock.fetch);

    const error = (await client.getJson('/x').catch((e: unknown) => e)) as GarminError;
    expect(error.code).toBe('rate_limited');
    expect(error.retryAfterSeconds).toBe(30);
    expect(mock.dataCalls()).toHaveLength(1);
  });

  it('reports invalid JSON', async () => {
    const mock = mockFetch([() => new Response('not json', { status: 200 })]);
    const { client } = makeClient(mock.fetch);

    await expect(client.getJson('/x')).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('returns null for an empty response only when asked to', async () => {
    const empty = () => new Response(null, { status: 204 });
    const optional = makeClient(mockFetch([empty]).fetch).client;
    await expect(optional.getOptionalJson('/x')).resolves.toBeNull();

    const required = makeClient(mockFetch([empty]).fetch).client;
    await expect(required.getJson('/x')).rejects.toMatchObject({ code: 'invalid_response' });
  });
});

describe('GarminClient.getBytes', () => {
  it('downloads with Accept: */*, which Garmin requires for files', async () => {
    const mock = mockFetch([() => new Response(Uint8Array.of(1, 2, 3))]);
    const { client } = makeClient(mock.fetch);
    expect(await client.getBytes('/files/1', 'file 1')).toEqual(Uint8Array.of(1, 2, 3));
    expect(mock.dataCalls()[0]?.accept).toBe('*/*');
  });

  it('retries and maps errors like JSON requests', async () => {
    const mock = mockFetch([
      () => new Response('busy', { status: 503 }),
      () => new Response('gone', { status: 404 }),
    ]);
    const { client } = makeClient(mock.fetch);
    await expect(client.getBytes('/files/1', 'file 1')).rejects.toThrow(/no data for file 1/);
    expect(mock.dataCalls()).toHaveLength(2);
  });

  it('gives up without retrying when Garmin does not answer in time', async () => {
    const { client, dataCalls } = clientWithTimeout(aborted);

    await expect(client.getJson('/x', {}, 'sleep for 2026-03-02')).rejects.toMatchObject({
      code: 'network',
      message: 'Garmin did not answer in time for sleep for 2026-03-02.',
    });
    expect(dataCalls()).toBe(1);
  });

  it('applies the time limit to a body that stalls', async () => {
    const { client, dataCalls } = clientWithTimeout((signal) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"ok":'));
          signal.addEventListener('abort', () => {
            controller.error(signal.reason);
          });
        },
      });
      return Promise.resolve(new Response(body));
    });

    await expect(client.getBytes('/file', 'the file of activity 1')).rejects.toMatchObject({
      code: 'network',
      message: 'Garmin did not answer in time for the file of activity 1.',
    });
    expect(dataCalls()).toBe(1);
  });

  it('retries once when the body fails to arrive', async () => {
    let attempt = 0;
    const { client, dataCalls } = clientWithTimeout(() => {
      attempt += 1;
      if (attempt > 1) return Promise.resolve(json({ ok: true }));
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(new TypeError('terminated'));
        },
      });
      return Promise.resolve(new Response(body));
    });

    await expect(client.getJson('/x')).resolves.toEqual({ ok: true });
    expect(dataCalls()).toBe(2);
  });
});
