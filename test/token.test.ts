import { describe, expect, it } from 'vitest';
import { GarminError } from '../src/garmin/errors';
import { MemoryStore } from '../src/garmin/store';
import { TokenProvider, jwtExpiry } from '../src/garmin/token';
import { NOW_MS, TEST_KEY, fakeJwt, mockFetch } from './helpers';

const now = () => NOW_MS;

describe('jwtExpiry', () => {
  it('reads exp from a JWT payload', () => {
    expect(jwtExpiry(fakeJwt(1_800_000_000))).toBe(1_800_000_000);
  });

  it('rejects non-JWTs and missing exp', () => {
    expect(jwtExpiry('not-a-jwt')).toBeUndefined();
    expect(jwtExpiry('a.b')).toBeUndefined();
    expect(jwtExpiry(`${fakeJwt(1).split('.')[0] ?? ''}.e30.sig`)).toBeUndefined();
  });
});

describe('TokenProvider', () => {
  it('requires a real API key', () => {
    const store = new MemoryStore(now);
    expect(() => new TokenProvider({ apiKey: undefined, store })).toThrow(GarminError);
    expect(() => new TokenProvider({ apiKey: 'your-key-here', store })).toThrow(/is set/);
  });

  it('exchanges the key with an ApiKey header and caches the token', async () => {
    const mock = mockFetch([]);
    const store = new MemoryStore(now);
    const tokens = new TokenProvider({ apiKey: TEST_KEY, store, fetch: mock.fetch, now });

    const first = await tokens.getToken();
    const second = await tokens.getToken();

    expect(first).toBe(second);
    expect(mock.tokenCalls()).toHaveLength(1);
    expect(mock.calls[0]?.method).toBe('POST');
    expect(mock.calls[0]?.authorization).toBe(`ApiKey ${TEST_KEY}`);
  });

  it('reuses the KV-cached token across provider instances', async () => {
    const mock = mockFetch([]);
    const store = new MemoryStore(now);
    const token = await new TokenProvider({
      apiKey: TEST_KEY,
      store,
      fetch: mock.fetch,
      now,
    }).getToken();
    const again = await new TokenProvider({
      apiKey: TEST_KEY,
      store,
      fetch: mock.fetch,
      now,
    }).getToken();

    expect(again).toBe(token);
    expect(mock.tokenCalls()).toHaveLength(1);
  });

  it('does not reuse a cached token after the key changes', async () => {
    const mock = mockFetch([]);
    const store = new MemoryStore(now);
    await new TokenProvider({ apiKey: TEST_KEY, store, fetch: mock.fetch, now }).getToken();
    await new TokenProvider({ apiKey: 'another-key', store, fetch: mock.fetch, now }).getToken();

    expect(mock.tokenCalls()).toHaveLength(2);
  });

  it('refreshes when the cached token is about to expire', async () => {
    const mock = mockFetch([]);
    const store = new MemoryStore(now);
    let current = NOW_MS;
    const tokens = new TokenProvider({
      apiKey: TEST_KEY,
      store,
      fetch: mock.fetch,
      now: () => current,
    });

    await tokens.getToken();
    current = NOW_MS + (86_400 - 60) * 1000; // one minute before expiry
    await tokens.getToken();

    expect(mock.tokenCalls()).toHaveLength(2);
  });

  it('deduplicates concurrent exchanges', async () => {
    const mock = mockFetch([]);
    const tokens = new TokenProvider({
      apiKey: TEST_KEY,
      store: new MemoryStore(now),
      fetch: mock.fetch,
      now,
    });

    await Promise.all([tokens.getToken(), tokens.getToken(), tokens.getToken()]);

    expect(mock.tokenCalls()).toHaveLength(1);
  });

  it('reports a rejected key as invalid_key without leaking it', async () => {
    const mock = mockFetch([], { tokenStatus: 401 });
    const tokens = new TokenProvider({
      apiKey: TEST_KEY,
      store: new MemoryStore(now),
      fetch: mock.fetch,
      now,
    });

    const error = await tokens.getToken().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GarminError);
    expect((error as GarminError).code).toBe('invalid_key');
    expect((error as GarminError).message).not.toContain(TEST_KEY);
  });

  it('rejects a token response that is not a JWT', async () => {
    const fetchFn = (() => Promise.resolve(new Response('<html>oops</html>'))) as typeof fetch;
    const tokens = new TokenProvider({
      apiKey: TEST_KEY,
      store: new MemoryStore(now),
      fetch: fetchFn,
      now,
    });

    await expect(tokens.getToken()).rejects.toMatchObject({ code: 'invalid_response' });
  });
});
