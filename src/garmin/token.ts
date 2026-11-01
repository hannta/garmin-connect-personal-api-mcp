// Exchanges the Personal API key for an access token (a JWT valid for ~24 h) and caches it.
// The cache key includes a fingerprint of the API key, so rotating the key starts fresh.

import { GarminError } from './errors';
import type { KeyValueStore } from './store';

export const DEFAULT_BASE_URL = 'https://personal.connectapi.garmin.com';
const TOKEN_PATH = '/personalapitoken-service/personal-api/personal-api-key/token';

/** Refresh this long before the token's own expiry. */
const REFRESH_MARGIN_SECONDS = 5 * 60;
/** Workers KV's minimum expirationTtl. */
const MIN_KV_TTL_SECONDS = 60;

export interface AccessToken {
  token: string;
  /** Expiry in epoch seconds, from the JWT `exp` claim. */
  expiresAt: number;
}

export interface TokenProviderOptions {
  apiKey: string | undefined;
  store: KeyValueStore;
  baseUrl?: string;
  fetch?: typeof fetch;
  now?: () => number;
}

export class TokenProvider {
  readonly #apiKey: string;
  readonly #store: KeyValueStore;
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  #inFlight: Promise<AccessToken> | undefined;
  #memory: AccessToken | undefined;

  constructor(options: TokenProviderOptions) {
    const apiKey = options.apiKey?.trim();
    if (!apiKey || apiKey === 'your-key-here') {
      throw new GarminError('missing_key', 'GARMIN_API_KEY is not set.');
    }
    this.#apiKey = apiKey;
    this.#store = options.store;
    this.#baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.#fetch = options.fetch ?? fetch.bind(globalThis);
    this.#now = options.now ?? Date.now;
  }

  /** Returns a cached token while it is fresh; otherwise exchanges the key for a new one. */
  async getToken(options: { forceRefresh?: boolean } = {}): Promise<string> {
    if (!options.forceRefresh) {
      if (this.#memory && this.#isFresh(this.#memory)) return this.#memory.token;
      const cached = await this.#readCache();
      if (cached && this.#isFresh(cached)) {
        this.#memory = cached;
        return cached.token;
      }
    }
    this.#inFlight ??= this.#exchange().finally(() => {
      this.#inFlight = undefined;
    });
    return (await this.#inFlight).token;
  }

  #isFresh(token: AccessToken): boolean {
    return token.expiresAt - this.#now() / 1000 > REFRESH_MARGIN_SECONDS;
  }

  async #cacheKey(): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(this.#apiKey));
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    return `garmin:token:${hex.slice(0, 16)}`;
  }

  async #readCache(): Promise<AccessToken | undefined> {
    const raw = await this.#store.get(await this.#cacheKey());
    if (!raw) return undefined;
    try {
      const parsed = JSON.parse(raw) as Partial<AccessToken>;
      if (typeof parsed.token === 'string' && typeof parsed.expiresAt === 'number') {
        return { token: parsed.token, expiresAt: parsed.expiresAt };
      }
    } catch {
      // Corrupt cache entry: ignore and exchange again.
    }
    return undefined;
  }

  async #exchange(): Promise<AccessToken> {
    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}${TOKEN_PATH}`, {
        method: 'POST',
        headers: { Accept: '*/*', Authorization: `ApiKey ${this.#apiKey}` },
      });
    } catch {
      throw new GarminError('network', 'Could not reach Garmin to exchange the API key.');
    }
    if (response.status === 401 || response.status === 403) {
      throw new GarminError(
        'invalid_key',
        'Garmin rejected the API key. It may have expired — create a new one in Garmin Connect.',
        response.status,
      );
    }
    if (!response.ok) {
      throw new GarminError(
        'upstream',
        `Garmin token endpoint returned HTTP ${response.status}.`,
        response.status,
      );
    }
    const token = (await response.text()).trim();
    const expiresAt = jwtExpiry(token);
    if (expiresAt === undefined) {
      throw new GarminError('invalid_response', 'Garmin token response was not a valid JWT.');
    }
    const accessToken = { token, expiresAt };
    this.#memory = accessToken;
    const ttl = Math.floor(expiresAt - this.#now() / 1000 - REFRESH_MARGIN_SECONDS);
    if (ttl >= MIN_KV_TTL_SECONDS) {
      await this.#store.put(await this.#cacheKey(), JSON.stringify(accessToken), {
        expirationTtl: ttl,
      });
    }
    return accessToken;
  }
}

/** Reads the `exp` claim (epoch seconds) from a JWT without verifying it. */
export function jwtExpiry(token: string): number | undefined {
  const payload = token.split('.')[1];
  if (!payload || token.split('.').length !== 3) return undefined;
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '='));
    const exp = (JSON.parse(json) as { exp?: unknown }).exp;
    return typeof exp === 'number' && Number.isFinite(exp) ? exp : undefined;
  } catch {
    return undefined;
  }
}
