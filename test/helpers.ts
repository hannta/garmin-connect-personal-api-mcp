import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GarminClient } from '../src/garmin/client';
import { MemoryStore } from '../src/garmin/store';
import { TokenProvider } from '../src/garmin/token';

export const TEST_KEY = 'test-api-key-not-real';
export const NOW_MS = Date.UTC(2026, 2, 2, 8, 0, 0);

export function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8'));
}

/** An unsigned JWT with the given `exp` (epoch seconds). */
export function fakeJwt(exp: number, extra: Record<string, unknown> = {}): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ exp, iat: exp - 86_400, ...extra })}.sig`;
}

export interface RecordedCall {
  url: URL;
  method: string;
  authorization: string | null;
}

type Responder = (call: RecordedCall) => Response | Promise<Response>;

/** A fetch stand-in: token requests get a fresh JWT; others go to the responders in order. */
export function mockFetch(responders: Responder[], options: { tokenStatus?: number } = {}) {
  const calls: RecordedCall[] = [];
  let tokenCount = 0;
  const queue = [...responders];
  const fn = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const headers = new Headers(init?.headers);
    const call = {
      url,
      method: init?.method ?? 'GET',
      authorization: headers.get('Authorization'),
    };
    calls.push(call);
    if (url.pathname.endsWith('/personal-api-key/token')) {
      tokenCount += 1;
      if (options.tokenStatus && options.tokenStatus !== 200) {
        return Promise.resolve(new Response('denied', { status: options.tokenStatus }));
      }
      return Promise.resolve(
        new Response(fakeJwt(NOW_MS / 1000 + 86_400, { n: tokenCount }), { status: 200 }),
      );
    }
    const next = queue.shift();
    if (!next) throw new Error(`Unexpected request: ${url.toString()}`);
    return Promise.resolve(next(call));
  };
  return {
    fetch: fn,
    calls,
    dataCalls: () => calls.filter((c) => !c.url.pathname.endsWith('/personal-api-key/token')),
    tokenCalls: () => calls.filter((c) => c.url.pathname.endsWith('/personal-api-key/token')),
  };
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

export function makeClient(fetchFn: typeof fetch, store = new MemoryStore(() => NOW_MS)) {
  const tokens = new TokenProvider({ apiKey: TEST_KEY, store, fetch: fetchFn, now: () => NOW_MS });
  const client = new GarminClient({ tokens, fetch: fetchFn, sleep: () => Promise.resolve() });
  return { client, tokens, store };
}
