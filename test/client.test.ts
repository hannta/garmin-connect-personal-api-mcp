import { describe, expect, it } from 'vitest';
import { GarminError } from '../src/garmin/errors';
import { json, makeClient, mockFetch } from './helpers';

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
