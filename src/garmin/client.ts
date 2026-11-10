// Authenticated requests to the Garmin Personal API.
// Retries: once with a fresh token on 401/403, once after a short pause on 502/503/504 or
// a network error. 404 and 429 are returned as typed errors without retrying. Each request
// has a time limit that covers its body; a request that runs out of time is not retried.

import { GarminError, errorFromStatus } from './errors';
import { DEFAULT_BASE_URL, REQUEST_TIMEOUT_MS, TokenProvider } from './token';

export type QueryValue = string | number | boolean | undefined;

export interface GarminClientOptions {
  tokens: TokenProvider;
  baseUrl?: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

const RETRYABLE_STATUS = new Set([502, 503, 504]);
const RETRY_DELAY_MS = 300;

export class GarminClient {
  readonly #tokens: TokenProvider;
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #timeoutMs: number;

  constructor(options: GarminClientOptions) {
    this.#tokens = options.tokens;
    this.#baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.#fetch = options.fetch ?? fetch.bind(globalThis);
    this.#sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.#timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  }

  /**
   * GET a JSON endpoint. `what` is a short description used in error messages
   * ("sleep for 2026-11-01"), never the URL, so messages stay readable.
   */
  async getJson<T>(path: string, query: Record<string, QueryValue> = {}, what = path): Promise<T> {
    const value = await this.getOptionalJson<T>(path, query, what);
    if (value === null) {
      throw new GarminError('invalid_response', `Garmin returned no data for ${what}.`);
    }
    return value;
  }

  /** Like `getJson`, but an empty response (e.g. 204 No Content) is `null`. */
  async getOptionalJson<T>(
    path: string,
    query: Record<string, QueryValue> = {},
    what = path,
  ): Promise<T | null> {
    const text = await this.#request(path, query, 'application/json', what, (response) =>
      response.text(),
    );
    if (text.trim() === '') return null;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new GarminError('invalid_response', `Garmin returned invalid JSON for ${what}.`);
    }
  }

  /** GET a file. Garmin answers 406 to `Accept: application/json` on downloads. */
  async getBytes(path: string, what = path): Promise<Uint8Array> {
    return this.#request(
      path,
      {},
      '*/*',
      what,
      async (response) => new Uint8Array(await response.arrayBuffer()),
    );
  }

  /** `read` takes the body: it is part of the request, with the same time limit and retry. */
  async #request<T>(
    path: string,
    query: Record<string, QueryValue>,
    accept: string,
    what: string,
    read: (response: Response) => Promise<T>,
  ): Promise<T> {
    const url = this.#url(path, query);
    let refreshedToken = false;
    let retriedUpstream = false;

    for (;;) {
      const token = await this.#tokens.getToken({ forceRefresh: refreshedToken });
      const signal = AbortSignal.timeout(this.#timeoutMs);
      /** After a failed fetch or body read: returns to retry, throws to give up. */
      const retryOrThrow = async (): Promise<void> => {
        if (signal.aborted) {
          throw new GarminError('network', `Garmin did not answer in time for ${what}.`);
        }
        if (retriedUpstream) {
          throw new GarminError('network', `Could not reach Garmin for ${what}.`);
        }
        retriedUpstream = true;
        await this.#sleep(RETRY_DELAY_MS);
      };

      let response: Response;
      try {
        response = await this.#fetch(url, {
          headers: { Accept: accept, Authorization: `Bearer ${token}` },
          signal,
        });
      } catch {
        await retryOrThrow();
        continue;
      }

      if ((response.status === 401 || response.status === 403) && !refreshedToken) {
        refreshedToken = true;
        continue;
      }
      if (RETRYABLE_STATUS.has(response.status) && !retriedUpstream) {
        retriedUpstream = true;
        await this.#sleep(RETRY_DELAY_MS);
        continue;
      }
      if (!response.ok) {
        throw errorFromStatus(response.status, what, response.headers.get('retry-after'));
      }
      try {
        return await read(response);
      } catch {
        await retryOrThrow();
      }
    }
  }

  #url(path: string, query: Record<string, QueryValue>): string {
    const url = new URL(`${this.#baseUrl}${path}`);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    return url.toString();
  }
}
