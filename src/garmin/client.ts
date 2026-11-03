// Authenticated JSON requests to the Garmin Personal API.
// Retries: once with a fresh token on 401/403, once after a short pause on 502/503/504 or
// a network error. 404 and 429 are returned as typed errors without retrying.

import { GarminError, errorFromStatus } from './errors';
import { DEFAULT_BASE_URL, TokenProvider } from './token';

export type QueryValue = string | number | boolean | undefined;

export interface GarminClientOptions {
  tokens: TokenProvider;
  baseUrl?: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const RETRYABLE_STATUS = new Set([502, 503, 504]);
const RETRY_DELAY_MS = 300;

export class GarminClient {
  readonly #tokens: TokenProvider;
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #sleep: (ms: number) => Promise<void>;

  constructor(options: GarminClientOptions) {
    this.#tokens = options.tokens;
    this.#baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.#fetch = options.fetch ?? fetch.bind(globalThis);
    this.#sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
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
    const url = this.#url(path, query);
    let refreshedToken = false;
    let retriedUpstream = false;

    for (;;) {
      const token = await this.#tokens.getToken({ forceRefresh: refreshedToken });
      let response: Response;
      try {
        response = await this.#fetch(url, {
          headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
        });
      } catch {
        if (!retriedUpstream) {
          retriedUpstream = true;
          await this.#sleep(RETRY_DELAY_MS);
          continue;
        }
        throw new GarminError('network', `Could not reach Garmin for ${what}.`);
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

      const text = await response.text();
      if (text.trim() === '') return null;
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new GarminError('invalid_response', `Garmin returned invalid JSON for ${what}.`);
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
